#include <windows.h>
#include <iostream>

HHOOK hHook;

LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION) {
        KBDLLHOOKSTRUCT *kbd = (KBDLLHOOKSTRUCT *)lParam;

        // Print what we blocked (optional)
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            std::cout << "Blocked key: " << kbd->vkCode << std::endl;
        }

        return 1; // Block ALL keys
    }

    return CallNextHookEx(hHook, nCode, wParam, lParam);
}

int main() {
    MSG msg;
    hHook = SetWindowsHookEx(WH_KEYBOARD_LL, LowLevelKeyboardProc, NULL, 0);

    if (!hHook) {
        std::cerr << "Failed to install hook!" << std::endl;
        return 1;
    }

    std::cout << "Blocking ALL keyboard input. Close console to exit." << std::endl;

    while (GetMessage(&msg, NULL, 0, 0)) {}

    UnhookWindowsHookEx(hHook);
    return 0;
}
