#include <windows.h>
#include <napi.h>
#include <dwmapi.h>
#include <gdiplus.h>
#include <iostream>
#include <VersionHelpers.h>

#pragma comment(lib, "Dwmapi.lib")

void DisableScreenCapture(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "Invalid HWND type. Expected Number.").ThrowAsJavaScriptException();
        return;
    }

    HWND hwnd = (HWND)(intptr_t)info[0].As<Napi::Number>().Int64Value();

    // Exclude window from capture
    SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
    // SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOSIZE);
    // ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);
}
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("disableScreenCapture", Napi::Function::New(env, DisableScreenCapture));
    return exports;
}

NODE_API_MODULE(blocker, Init)
