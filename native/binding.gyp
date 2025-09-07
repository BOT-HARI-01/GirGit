{
    "targets": [
        {
            "target_name": "blocker",
            "sources": ["captureBlocker.cpp"],
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "<!(node -e \"require('nan')\")",
            ],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "conditions": [
                ["OS=='win'", {"libraries": ["dwmapi.lib", "gdiplus.lib", "dcomp.lib"]}]
            ],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
        },
        # "D:/CODEPRACTICE/stealthWin/whisper.cpp/src/whisper.cpp",
        {
            "target_name": "listener",
            "sources": ["listener.cpp",],
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "<!(node -e \"require('nan')\")",
                "D:/CODEPRACTICE/stealthWin/whisper.cpp/include",
                "D:/CODEPRACTICE/stealthWin/whisper.cpp/ggml/include",
                
            ],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "conditions": [
                [
                    "OS=='win'",
                    {
                        "libraries": [
                            "gdiplus.lib",
                            "Ole32.lib",
                            "mfplat.lib",
                            "mfreadwrite.lib",
                            "mfuuid.lib",
                            "wmcodecdspuuid.lib",
                            # "D:/CODEPRACTICE/stealthWin/whisper.cpp/build/src/Release/whisper.lib",
                            "D:/CODEPRACTICE/stealthWin/whisper.cpp/build/src/Debug/whisper.lib",
                        ]
                    },
                ]
            ],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
        },
    ]
}
