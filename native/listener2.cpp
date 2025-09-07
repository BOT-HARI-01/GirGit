#include <windows.h>
#include <napi.h>
#include <Mmdeviceapi.h>
#include <Audioclient.h>
#include <Audiopolicy.h>
#include <iostream>
#include <assert.h>
#include <fstream>
#pragma comment(lib, "Ole32.lib")

IAudioClient *audioClient = nullptr;
IAudioCaptureClient *captureClient = nullptr;
IMMDevice *defaultDevice = nullptr;
IMMDeviceEnumerator *deviceEnumerator = nullptr;
WAVEFORMATEX *pwfx = nullptr;
FILE *wavFile = nullptr;
BYTE *chunkBuffer = nullptr;
BYTE *dataBuffer = nullptr;
int bufferBytesCaptured = 0;
int totalBytesCaptured = 0;
bool capturing = false;
HANDLE captureThread = NULL;

void write_wav_header(FILE *f, int sample_rate, int bits_per_sample, int channels, int data_size)
{
    int byte_rate = sample_rate * channels * bits_per_sample / 8;
    int block_align = channels * bits_per_sample / 8;
    int subchunk2_size = data_size;

    fwrite("RIFF", 1, 4, f);
    int chunk_size = 36 + subchunk2_size;
    fwrite(&chunk_size, 4, 1, f);
    fwrite("WAVE", 1, 4, f);

    fwrite("fmt ", 1, 4, f);
    int subchunk1_size = 16;
    short audio_format = 1;
    fwrite(&subchunk1_size, 4, 1, f);
    fwrite(&audio_format, 2, 1, f);
    fwrite(&channels, 2, 1, f);
    fwrite(&sample_rate, 4, 1, f);
    fwrite(&byte_rate, 4, 1, f);
    fwrite(&block_align, 2, 1, f);
    fwrite(&bits_per_sample, 2, 1, f);

    fwrite("data", 1, 4, f);
    fwrite(&subchunk2_size, 4, 1, f);
}


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
         
        if (CreateDirectoryA(folderPath.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS)
        {
            return true;
        }
        else
        {
            return false;  
        }
    }
    else if (ftyp & FILE_ATTRIBUTE_DIRECTORY)
    {
         
        return true;
    }
    else
    {
         
        return false;
    }
}
DWORD WINAPI CaptureAudioThread(LPVOID)
{
    CreateFolderIfNotExists("chunks");
    const int bytesPerSample = pwfx->wBitsPerSample / 8;
    const int bytesPerFrame = pwfx->nChannels * bytesPerSample;
    const int bufferSize = pwfx->nSamplesPerSec * bytesPerFrame * 60;
    dataBuffer = new BYTE[bufferSize];
    chunkBuffer = new BYTE[bufferSize];

    bufferBytesCaptured = 0;
    totalBytesCaptured = 0;

    const int chunkDurationSec = 5;
    const int bytesPerSecond = pwfx->nAvgBytesPerSec;
    const int chunkSize = bytesPerSecond * chunkDurationSec;
    int chunkIndex = 0;

    while (capturing)
    {
        UINT32 packetLength = 0;
        HRESULT hr = captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr))
            continue;

        if (packetLength == 0)
        {
            Sleep(10);
            continue;
        }

        BYTE *data;
        UINT32 numFrames;
        DWORD flags;
        hr = captureClient->GetBuffer(&data, &numFrames, &flags, NULL, NULL);
        if (FAILED(hr))
            continue;

        int numBytes = numFrames * bytesPerFrame;
        if (bufferBytesCaptured + numBytes <= bufferSize)
        {
            memcpy(chunkBuffer + bufferBytesCaptured, data, numBytes);
            bufferBytesCaptured += numBytes;
        }
        if(totalBytesCaptured + numBytes <= bufferSize){
            memcpy(dataBuffer + totalBytesCaptured, data, numBytes);
            totalBytesCaptured += numBytes;
        }
        captureClient->ReleaseBuffer(numFrames);
         
        if (bufferBytesCaptured >= chunkSize)
        {
            std::string chunkFilename = "chunks\\chunk_" + std::to_string(chunkIndex++) + ".wav";
            FILE *chunkFile = fopen(chunkFilename.c_str(), "wb");
            fseek(chunkFile, 44, SEEK_SET);
            fwrite(chunkBuffer, 1, bufferBytesCaptured, chunkFile);
             
            fseek(chunkFile, 0, SEEK_SET);
            write_wav_header(chunkFile, pwfx->nSamplesPerSec, pwfx->wBitsPerSample, pwfx->nChannels, bufferBytesCaptured);
            fclose(chunkFile);
            bufferBytesCaptured = 0;
        }
    }
    return 0;
}

Napi::Value StartCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    CoInitialize(NULL);
    CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void **)&deviceEnumerator);
    deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
    defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void **)&audioClient);
    audioClient->GetMixFormat(&pwfx);
    audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10000000, 0, pwfx, NULL);
    audioClient->Start();
    audioClient->GetService(__uuidof(IAudioCaptureClient), (void **)&captureClient);
    std::cout << "Sample Rate: " << pwfx->nSamplesPerSec << "\n";
    std::cout << "Bits per Sample: " << pwfx->wBitsPerSample << "\n";
    std::cout << "Channels: " << pwfx->nChannels << "\n";

    wavFile = fopen("output.wav", "wb");
    fseek(wavFile, 44, SEEK_SET);
    capturing = true;
    captureThread = CreateThread(NULL, 0, CaptureAudioThread, NULL, 0, NULL);

    return Napi::String::New(env, "Capture started");
}

Napi::Value StopCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    capturing = false;
    WaitForSingleObject(captureThread, INFINITE);
    fwrite(dataBuffer, 1, totalBytesCaptured, wavFile);
    fseek(wavFile, 0, SEEK_SET);
    write_wav_header(wavFile, pwfx->nSamplesPerSec, pwfx->wBitsPerSample, pwfx->nChannels, totalBytesCaptured);
    fclose(wavFile);

    captureClient->Release();
    audioClient->Stop();
    audioClient->Release();
    defaultDevice->Release();
    deviceEnumerator->Release();
    CoUninitialize();

    delete[] dataBuffer;
    delete[] chunkBuffer;
    return Napi::String::New(env, "Capture stopped");
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("startCapture", Napi::Function::New(env, StartCapture));
    exports.Set("stopCapture", Napi::Function::New(env, StopCapture));
    return exports;
}

NODE_API_MODULE(audio_capture, Init)