#include <windows.h>
#include <napi.h>
#include <Mmdeviceapi.h>
#include <Audioclient.h>
#include <Audiopolicy.h>
#include <iostream>
#include <vector>
#include <string>
#include <queue>
#include <mutex>
#include <condition_variable>

#include <whisper.h>

// Include Windows Media Foundation headers for resampling
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wmcodecdsp.h> // For CLSID_CResamplerMediaObject

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")

// --- Thread-Safe Queue for Audio Data ---
struct ThreadSafeQueue
{
    std::queue<std::vector<float>> q;
    std::mutex m;
    std::condition_variable cv;
};

// --- Global Variables ---
IAudioClient *audioClient = nullptr;
IAudioCaptureClient *captureClient = nullptr;
IMMDevice *defaultDevice = nullptr;
IMMDeviceEnumerator *deviceEnumerator = nullptr;
WAVEFORMATEX *pwfx = nullptr;
IMFTransform *pResampler = nullptr;

HANDLE captureThread = NULL;
HANDLE whisperThread = NULL;

bool capturing = false;
bool processing = false;

ThreadSafeQueue audioQueue;

// Target audio format for Whisper
const int TARGET_SAMPLE_RATE = 16000;
const int TARGET_BITS_PER_SAMPLE = 16;
const int TARGET_CHANNELS = 1; // Whisper works best with mono

// Whisper context and parameters
whisper_context_params cparams = whisper_context_default_params();
struct whisper_context *wctx = nullptr; // Initialize later
struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

Napi::ThreadSafeFunction tsfn;

void InitCallback(const Napi::Env &env, Napi::Function jsCallback)
{
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        jsCallback,        // JS callback
        "WhisperCallback", // Resource name
        0,                 // Unlimited queue
        1                  // Only one thread will call
    );
}

Napi::Value RedgCallBack(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    if (!info[0].IsFunction())
    {
        Napi::TypeError::New(env, "Expected function").ThrowAsJavaScriptException();
        return env.Null();
    }

    InitCallback(env, info[0].As<Napi::Function>());
    return env.Null();
}
// --- [NEW] Whisper Callback for Real-Time Results ---
// This function is called by whisper.cpp every time a new segment of text is transcribed.
void NewSegmentCallback(struct whisper_context *ctx, struct whisper_state *state, int n_new, void *user_data)
{
    // The main whisper processing loop is in a different thread, so we can get the total segments count.
    const int n_segments = whisper_full_n_segments(ctx);

    // This callback is called with 'n_new' new segments. We'll print the last 'n_new' segments.
    for (int i = n_segments - n_new; i < n_segments; ++i)
    {
        const char *text = whisper_full_get_segment_text(ctx, i);
        // Print text immediately to the console
        std::string segment(text);
        tsfn.BlockingCall([segment](Napi::Env env, Napi::Function jsCallback)
                          { jsCallback.Call({Napi::String::New(env, segment)}); });
        std::cout << text << std::flush;
    }
}

// --- Whisper Processing Thread (Consumer) ---
DWORD WINAPI WhisperProcessingThread(LPVOID)
{
    std::vector<float> audioBuffer;
    // We can use a larger buffer for better accuracy, as the callback gives us real-time results.
    // const size_t processing_interval_samples = TARGET_SAMPLE_RATE * 1; // Process in 2-second chunks
    const size_t processing_interval_samples = TARGET_SAMPLE_RATE / 10; // Process in 2-second chunks
    while (processing)
    {
        {
            std::unique_lock<std::mutex> lock(audioQueue.m);
            audioQueue.cv.wait(lock, [&]
                               { return !audioQueue.q.empty() || !processing; });

            if (!processing && audioQueue.q.empty())
            {
                break;
            }

            while (!audioQueue.q.empty())
            {
                std::vector<float> chunk = std::move(audioQueue.q.front());
                audioQueue.q.pop();
                audioBuffer.insert(audioBuffer.end(), chunk.begin(), chunk.end());
            }
        }

        if (!audioBuffer.empty() && audioBuffer.size() > processing_interval_samples)
        {
            if (whisper_full(wctx, wparams, audioBuffer.data(), audioBuffer.size()) != 0)
            {
                std::cerr << "Whisper failed to process audio chunk\n";
            }
            else
            {
                // The callback has already printed the streaming results.
                // We print a newline here to signify the end of a processing chunk.
                std::cout << std::endl;
            }
            audioBuffer.clear();
        }
    }
    return 0;
}

// --- Audio Capture Thread (Producer) ---
DWORD WINAPI CaptureAudioThread(LPVOID)
{
    // A thread that uses COM must initialize it
    CoInitializeEx(NULL, COINIT_MULTITHREADED);

    HRESULT hr;
    while (capturing)
    {
        UINT32 packetLength = 0;
        hr = captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr) || packetLength == 0)
        {
            Sleep(1); // Wait a bit if no packet is available
            continue;
        }

        BYTE *pData;
        UINT32 numFramesAvailable;
        DWORD flags;
        hr = captureClient->GetBuffer(&pData, &numFramesAvailable, &flags, NULL, NULL);
        if (FAILED(hr))
        {
            continue;
        }

        if (numFramesAvailable > 0)
        {
            // 1. Create a media buffer for the captured data
            IMFMediaBuffer *pBuffer = NULL;
            hr = MFCreateMemoryBuffer(numFramesAvailable * pwfx->nBlockAlign, &pBuffer);

            BYTE *pMFData = NULL;
            if (SUCCEEDED(hr))
            {
                pBuffer->Lock(&pMFData, NULL, NULL);
                memcpy(pMFData, pData, numFramesAvailable * pwfx->nBlockAlign);
                pBuffer->Unlock();
                pBuffer->SetCurrentLength(numFramesAvailable * pwfx->nBlockAlign);
            }

            captureClient->ReleaseBuffer(numFramesAvailable);

            IMFSample *pSample = NULL;
            if (SUCCEEDED(hr))
                hr = MFCreateSample(&pSample);
            if (SUCCEEDED(hr))
                hr = pSample->AddBuffer(pBuffer);

            // 2. Process the input sample through the resampler
            if (SUCCEEDED(hr))
                hr = pResampler->ProcessInput(0, pSample, 0);

            pBuffer->Release();
            pSample->Release();

            // 3. Get the resampled output data from the transform
            if (SUCCEEDED(hr))
            {
                while (true)
                {
                    MFT_OUTPUT_DATA_BUFFER outputDataBuffer = {0};
                    IMFSample *pOutSample = NULL;
                    MFCreateSample(&pOutSample);
                    IMFMediaBuffer *pOutBuffer = NULL;
                    MFCreateMemoryBuffer(4096, &pOutBuffer); // Create a buffer for output
                    // MFCreateMemoryBuffer(2048, &pOutBuffer); // Create a buffer for output
                    pOutSample->AddBuffer(pOutBuffer);
                    outputDataBuffer.pSample = pOutSample;

                    DWORD dwStatus;
                    hr = pResampler->ProcessOutput(0, 1, &outputDataBuffer, &dwStatus);

                    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT)
                    {
                        pOutSample->Release();
                        pOutBuffer->Release();
                        break; // Need more data, exit inner loop
                    }

                    // 4. Convert resampled data and push to queue
                    IMFMediaBuffer *pContiguousBuffer = NULL;
                    outputDataBuffer.pSample->ConvertToContiguousBuffer(&pContiguousBuffer);

                    BYTE *pResampledData = NULL;
                    DWORD cbBytes = 0;
                    pContiguousBuffer->Lock(&pResampledData, NULL, &cbBytes);

                    if (cbBytes > 0)
                    {
                        size_t numSamples = cbBytes / (TARGET_BITS_PER_SAMPLE / 8);
                        std::vector<float> pcmf32(numSamples);
                        int16_t *pcm16 = reinterpret_cast<int16_t *>(pResampledData);

                        for (size_t i = 0; i < numSamples; i++)
                        {
                            pcmf32[i] = static_cast<float>(pcm16[i]) / 32768.0f;
                        }

                        // Push to thread-safe queue
                        {
                            std::lock_guard<std::mutex> lock(audioQueue.m);
                            audioQueue.q.push(std::move(pcmf32));
                        }
                        audioQueue.cv.notify_one();
                    }

                    pContiguousBuffer->Unlock();
                    pContiguousBuffer->Release();
                    pOutSample->Release();
                    pOutBuffer->Release();
                }
            }
        }
    }

    // Uninitialize COM for this thread
    CoUninitialize();
    return 0;
}

// --- StartCapture ---
Napi::Value StartCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    std::string modelFile = info[0].As<Napi::String>().Utf8Value();
    if (!wctx)
    {
        wctx = whisper_init_from_file_with_params(modelFile.c_str(), cparams);
        // wctx = whisper_init_from_file_with_params("ggml-small.en.bin", cparams);
        if (!wctx)
        {
            return Napi::String::New(env, "Failed to initialize whisper context from file");
        }
        // --- [MODIFIED] Set the callback on the whisper parameters ---
        wparams.new_segment_callback = NewSegmentCallback;
        wparams.print_progress = false;
        wparams.print_realtime = false;
        wparams.print_timestamps = false;
        wparams.single_segment = false; 
        wparams.max_tokens = 32;      
        wparams.audio_ctx = 512;
    }

    CoInitialize(NULL);
    MFStartup(MF_VERSION, MFSTARTUP_FULL);

    HRESULT hr;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void **)&deviceEnumerator);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to create device enumerator");

    hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to get default audio endpoint");

    hr = defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void **)&audioClient);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to activate audio client");

    hr = audioClient->GetMixFormat(&pwfx);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to get mix format");

    if (pwfx->wFormatTag != WAVE_FORMAT_EXTENSIBLE ||
        ((WAVEFORMATEXTENSIBLE *)pwfx)->SubFormat != KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)
    {
        CoTaskMemFree(pwfx);
        return Napi::String::New(env, "Unsupported audio format. Expected 32-bit float.");
    }

    // --- SETUP WMF RESAMPLER ---
    hr = CoCreateInstance(CLSID_CResamplerMediaObject, NULL, CLSCTX_INPROC_SERVER, IID_IMFTransform, (void **)&pResampler);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to create resampler");

    // 1. Configure Input Type (from WASAPI)
    IMFMediaType *pInputType = NULL;
    MFCreateMediaType(&pInputType);
    pInputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    pInputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    pInputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, pwfx->nChannels);
    pInputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, pwfx->nSamplesPerSec);
    pInputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, pwfx->nBlockAlign);
    pInputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, pwfx->nAvgBytesPerSec);
    pInputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 32); // 32-bit float
    pResampler->SetInputType(0, pInputType, 0);
    pInputType->Release();

    // 2. Configure Output Type (our target format)
    IMFMediaType *pOutputType = NULL;
    MFCreateMediaType(&pOutputType);
    pOutputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    pOutputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
    pOutputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, TARGET_CHANNELS);
    pOutputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, TARGET_SAMPLE_RATE);
    pOutputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, TARGET_BITS_PER_SAMPLE);
    pOutputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, TARGET_CHANNELS * (TARGET_BITS_PER_SAMPLE / 8));
    pOutputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, TARGET_SAMPLE_RATE * TARGET_CHANNELS * (TARGET_BITS_PER_SAMPLE / 8));
    pResampler->SetOutputType(0, pOutputType, 0);
    pOutputType->Release();

    hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1000000, 0, pwfx, NULL);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to initialize audio client");

    hr = audioClient->GetService(__uuidof(IAudioCaptureClient), (void **)&captureClient);
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to get capture client");

    hr = audioClient->Start();
    if (FAILED(hr))
        return Napi::String::New(env, "Failed to start audio client");

    std::cout << "Capture started. Source: " << pwfx->nSamplesPerSec << " Hz, "
              << pwfx->wBitsPerSample << "-bit float. Target: " << TARGET_SAMPLE_RATE << " Hz, "
              << TARGET_BITS_PER_SAMPLE << "-bit PCM mono.\n";

    capturing = true;
    processing = true;
    captureThread = CreateThread(NULL, 0, CaptureAudioThread, NULL, 0, NULL);
    whisperThread = CreateThread(NULL, 0, WhisperProcessingThread, NULL, 0, NULL);

    return Napi::String::New(env, "Capture started");
}

// --- StopCapture ---
Napi::Value StopCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    if (!capturing)
    {
        return Napi::String::New(env, "Capture not running");
    }

    capturing = false;
    processing = false;
    audioQueue.cv.notify_all(); // Wake up processing thread so it can exit

    if (captureThread)
    {
        WaitForSingleObject(captureThread, INFINITE);
        CloseHandle(captureThread);
        captureThread = NULL;
    }
    if (whisperThread)
    {
        WaitForSingleObject(whisperThread, INFINITE);
        CloseHandle(whisperThread);
        whisperThread = NULL;
    }

    // Clear any leftover data from the queue
    std::queue<std::vector<float>> empty;
    std::swap(audioQueue.q, empty);

    if (audioClient)
        audioClient->Stop();

    // Release all COM objects
    if (captureClient)
    {
        captureClient->Release();
        captureClient = nullptr;
    }
    if (audioClient)
    {
        audioClient->Release();
        audioClient = nullptr;
    }
    if (defaultDevice)
    {
        defaultDevice->Release();
        defaultDevice = nullptr;
    }
    if (deviceEnumerator)
    {
        deviceEnumerator->Release();
        deviceEnumerator = nullptr;
    }
    if (pResampler)
    {
        pResampler->Release();
        pResampler = nullptr;
    }
    if (pwfx)
    {
        CoTaskMemFree(pwfx);
        pwfx = nullptr;
    }

    MFShutdown();
    CoUninitialize();

    std::cout << "Capture stopped.\n";
    return Napi::String::New(env, "Capture stopped");
}

// --- N-API Boilerplate ---
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    exports.Set("callback", Napi::Function::New(env, RedgCallBack));
    return exports;
}

NODE_API_MODULE(audio_capture, Init)
