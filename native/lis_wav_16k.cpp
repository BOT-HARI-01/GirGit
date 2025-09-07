#include <windows.h>
#include <napi.h>
#include <Mmdeviceapi.h>
#include <Audioclient.h>
#include <Audiopolicy.h>
#include <iostream>
#include <vector>
#include<whisper.h>
// Include Windows Media Foundation headers for resampling
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wmcodecdsp.h> // For CLSID_CResamplerMediaObject

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "mfplat.lib") // WMF library
#pragma comment(lib, "mfreadwrite.lib") // WMF library
#pragma comment(lib, "mfuuid.lib") // WMF library


// --- Global Variables ---
IAudioClient *audioClient = nullptr;
IAudioCaptureClient *captureClient = nullptr;
IMMDevice *defaultDevice = nullptr;
IMMDeviceEnumerator *deviceEnumerator = nullptr;
WAVEFORMATEX *pwfx = nullptr;
FILE *wavFile = nullptr;
HANDLE captureThread = NULL;

bool capturing = false;

// WMF Resampler
IMFTransform *pResampler = nullptr;

// We will use std::vector as a dynamic buffer, which is safer than raw new/delete
std::vector<BYTE> totalAudioBuffer;
std::vector<BYTE> chunkAudioBuffer;

// Target audio format
const int TARGET_SAMPLE_RATE = 16000;
const int TARGET_BITS_PER_SAMPLE = 16;
const int TARGET_CHANNELS = 2; // Assuming stereo, can be adjusted


// --- WAV Header Function (Unchanged) ---
void write_wav_header(FILE *f, int sample_rate, int bits_per_sample, int channels, int data_size)
{
    fseek(f, 0, SEEK_SET); // Ensure we are at the beginning of the file

    int byte_rate = sample_rate * channels * bits_per_sample / 8;
    int block_align = channels * bits_per_sample / 8;
    int subchunk2_size = data_size;
    int chunk_size = 36 + subchunk2_size;

    // RIFF chunk
    fwrite("RIFF", 1, 4, f);
    fwrite(&chunk_size, 4, 1, f);
    fwrite("WAVE", 1, 4, f);

    // fmt sub-chunk
    fwrite("fmt ", 1, 4, f);
    int subchunk1_size = 16;
    short audio_format = 1; // 1 = PCM
    fwrite(&subchunk1_size, 4, 1, f);
    fwrite(&audio_format, 2, 1, f);
    fwrite(&channels, 2, 1, f);
    fwrite(&sample_rate, 4, 1, f);
    fwrite(&byte_rate, 4, 1, f);
    fwrite(&block_align, 2, 1, f);
    fwrite(&bits_per_sample, 2, 1, f);

    // data sub-chunk
    fwrite("data", 1, 4, f);
    fwrite(&subchunk2_size, 4, 1, f);
}


// --- Utility Function (Minor Improvement) ---
bool CreateFolderIfNotExists(const std::string &folderPath)
{

    WIN32_FIND_DATAA findFileData;
    HANDLE hFind;

    std::string searchPath = folderPath + "\\*";
    hFind = FindFirstFileA(searchPath.c_str(), &findFileData);
    if (hFind == INVALID_HANDLE_VALUE)
        return false;

    do
    {
        if (!(findFileData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
        {
            std::string filePath = folderPath + "\\" + findFileData.cFileName;
            DeleteFileA(filePath.c_str());
        }
    } while (FindNextFileA(hFind, &findFileData));

    FindClose(hFind);

    DWORD ftyp = GetFileAttributesA(folderPath.c_str());
    if (ftyp == INVALID_FILE_ATTRIBUTES)
    {
        // Folder does not exist, create it
        if (CreateDirectoryA(folderPath.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS)
        {
            return true;
        }
        else
        {
            return false; // failed to create
        }
    }
    else if (ftyp & FILE_ATTRIBUTE_DIRECTORY)
    {
        // Folder already exists
        return true;
    }
    else
    {
        // Exists but not a directory
        return false;
    }
}


// --- Audio Capture Thread (Heavily Modified) ---
DWORD WINAPI CaptureAudioThread(LPVOID)
{
    CreateFolderIfNotExists("chunks");

    // Clear buffers from any previous session
    totalAudioBuffer.clear();
    chunkAudioBuffer.clear();

    const int chunkDurationSec = 3;
    const int targetBytesPerSecond = TARGET_SAMPLE_RATE * TARGET_CHANNELS * (TARGET_BITS_PER_SAMPLE / 8);
    const int chunkSizeBytes = targetBytesPerSecond * chunkDurationSec;
    int chunkIndex = 0;
    
    HRESULT hr;

    while (capturing)
    {
        UINT32 packetLength = 0;
        hr = captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr) || packetLength == 0)
        {
            Sleep(10);
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
        
        // --- WMF PROCESSING ---
        // 1. Create a media buffer and copy the captured raw data into it
        IMFMediaBuffer *pBuffer = NULL;
        hr = MFCreateMemoryBuffer(numFramesAvailable * pwfx->nBlockAlign, &pBuffer);
        
        BYTE *pMFData = NULL;
        if(SUCCEEDED(hr)) {
             pBuffer->Lock(&pMFData, NULL, NULL);
             memcpy(pMFData, pData, numFramesAvailable * pwfx->nBlockAlign);
             pBuffer->Unlock();
             pBuffer->SetCurrentLength(numFramesAvailable * pwfx->nBlockAlign);
        }
        
        // Release the original WASAPI buffer
        captureClient->ReleaseBuffer(numFramesAvailable);

        IMFSample *pSample = NULL;
        if(SUCCEEDED(hr)) {
            hr = MFCreateSample(&pSample);
        }
        if(SUCCEEDED(hr)) {
            hr = pSample->AddBuffer(pBuffer);
        }

        // 2. Process the input sample through the resampler
        if(SUCCEEDED(hr)) {
            hr = pResampler->ProcessInput(0, pSample, 0);
        }
        
        if (SUCCEEDED(hr))
        {
            while (true)
            {
                // 3. Get the resampled output data
                IMFMediaBuffer *pOutBuffer = NULL;
                IMFSample *pOutSample = NULL;
                hr = MFCreateSample(&pOutSample);
                if(SUCCEEDED(hr)) hr = MFCreateMemoryBuffer(4096, &pOutBuffer); // Create a buffer for output
                if(SUCCEEDED(hr)) hr = pOutSample->AddBuffer(pOutBuffer);

                MFT_OUTPUT_DATA_BUFFER outputDataBuffer = {0};
                outputDataBuffer.pSample = pOutSample;
                
                DWORD dwStatus;
                hr = pResampler->ProcessOutput(0, 1, &outputDataBuffer, &dwStatus);

                if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT)
                {
                    // Resampler needs more data, break inner loop and get more from WASAPI
                    pOutBuffer->Release();
                    pOutSample->Release();
                    break; 
                }

                // 4. Copy the resampled data to our own buffers
                BYTE *pResampledData = NULL;
                DWORD cbBytes = 0;
                outputDataBuffer.pSample->ConvertToContiguousBuffer(&pOutBuffer);
                pOutBuffer->Lock(&pResampledData, NULL, &cbBytes);

                if(cbBytes > 0) {
                    totalAudioBuffer.insert(totalAudioBuffer.end(), pResampledData, pResampledData + cbBytes);
                    chunkAudioBuffer.insert(chunkAudioBuffer.end(), pResampledData, pResampledData + cbBytes);
                }
                
                pOutBuffer->Unlock();
                pOutBuffer->Release();
                pOutSample->Release();
            }
        }
        
        pBuffer->Release();
        pSample->Release();

        // --- CHUNK MAKING LOGIC (using resampled data) ---
        if (chunkAudioBuffer.size() >= chunkSizeBytes)
        {
            std::string chunkFilename = "chunks\\chunk_" + std::to_string(chunkIndex++) + ".wav";
            FILE *chunkFile = fopen(chunkFilename.c_str(), "wb");
            if (chunkFile)
            {
                // Write a placeholder header, then the data, then the final header
                fwrite("TEMP", 1, 44, chunkFile); 
                fwrite(chunkAudioBuffer.data(), 1, chunkAudioBuffer.size(), chunkFile);
                write_wav_header(chunkFile, TARGET_SAMPLE_RATE, TARGET_BITS_PER_SAMPLE, TARGET_CHANNELS, chunkAudioBuffer.size());
                fclose(chunkFile);
            }
            chunkAudioBuffer.clear();
        }
    }
    return 0;
}


// --- StartCapture (Modified for WMF Setup) ---
Napi::Value StartCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    CoInitialize(NULL);
    // Initialize Media Foundation
    MFStartup(MF_VERSION, MFSTARTUP_FULL);

    HRESULT hr;

    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void **)&deviceEnumerator);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to create device enumerator");

    hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to get default audio endpoint");

    hr = defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void **)&audioClient);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to activate audio client");

    hr = audioClient->GetMixFormat(&pwfx);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to get mix format");
    
    // Check if the source format is float
    if (pwfx->wFormatTag != WAVE_FORMAT_EXTENSIBLE ||
       ((WAVEFORMATEXTENSIBLE*)pwfx)->SubFormat != KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
        // This code is designed for float input, handle other cases if needed
        CoTaskMemFree(pwfx);
        return Napi::String::New(env, "Unsupported audio format. Expected 32-bit float.");
    }

    // --- SETUP WMF RESAMPLER ---
    hr = CoCreateInstance(CLSID_CResamplerMediaObject, NULL, CLSCTX_INPROC_SERVER, IID_IMFTransform, (void**)&pResampler);
    if (FAILED(hr)) return Napi::String::New(env, "Failed to create resampler");

    // 1. Configure Input Type (from WASAPI)
    IMFMediaType *pInputType = NULL;
    MFCreateMediaType(&pInputType);
    pInputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    pInputType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    pInputType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, pwfx->nChannels);
    pInputType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, pwfx->nSamplesPerSec);
    pInputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, pwfx->nBlockAlign);
    pInputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, pwfx->nAvgBytesPerSec);
    pInputType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 32);
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
    pOutputType->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, TARGET_CHANNELS * TARGET_BITS_PER_SAMPLE / 8);
    pOutputType->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, TARGET_SAMPLE_RATE * TARGET_CHANNELS * TARGET_BITS_PER_SAMPLE / 8);
    pResampler->SetOutputType(0, pOutputType, 0);
    pOutputType->Release();
    // --- END WMF SETUP ---

    hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10000000, 0, pwfx, NULL);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to initialize audio client");

    hr = audioClient->GetService(__uuidof(IAudioCaptureClient), (void **)&captureClient);
    if(FAILED(hr)) return Napi::String::New(env, "Failed to get capture client");

    hr = audioClient->Start();
    if(FAILED(hr)) return Napi::String::New(env, "Failed to start audio client");
    
    std::cout << "Capture started. Source: " << pwfx->nSamplesPerSec << " Hz, " << pwfx->wBitsPerSample << "-bit float. Target: " << TARGET_SAMPLE_RATE << " Hz, " << TARGET_BITS_PER_SAMPLE << "-bit PCM.\n";

    wavFile = fopen("output.wav", "wb");
    // Write a placeholder header that we'll overwrite on stop
    BYTE placeholder[44] = {0};
    fwrite(placeholder, 1, 44, wavFile);

    capturing = true;
    captureThread = CreateThread(NULL, 0, CaptureAudioThread, NULL, 0, NULL);

    return Napi::String::New(env, "Capture started");
}


// --- StopCapture (Modified for Cleanup) ---
Napi::Value StopCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();
    if (!capturing) {
        return Napi::String::New(env, "Capture not running");
    }

    capturing = false;
    WaitForSingleObject(captureThread, INFINITE);
    CloseHandle(captureThread);
    captureThread = NULL;

    if (wavFile)
    {
        // Write the final resampled data and the correct header
        fwrite(totalAudioBuffer.data(), 1, totalAudioBuffer.size(), wavFile);
        write_wav_header(wavFile, TARGET_SAMPLE_RATE, TARGET_BITS_PER_SAMPLE, TARGET_CHANNELS, totalAudioBuffer.size());
        fclose(wavFile);
        wavFile = NULL;
    }

    if(audioClient) audioClient->Stop();

    // Release all COM objects
    if(captureClient) captureClient->Release();
    if(audioClient) audioClient->Release();
    if(defaultDevice) defaultDevice->Release();
    if(deviceEnumerator) deviceEnumerator->Release();
    if(pResampler) pResampler->Release();
    if(pwfx) CoTaskMemFree(pwfx);

    // Shutdown Media Foundation
    MFShutdown();
    CoUninitialize();

    captureClient = nullptr;
    audioClient = nullptr;
    defaultDevice = nullptr;
    deviceEnumerator = nullptr;
    pResampler = nullptr;
    pwfx = nullptr;

    std::cout << "Capture stopped.\n";

    return Napi::String::New(env, "Capture stopped");
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    return exports;
}

NODE_API_MODULE(audio_capture, Init)