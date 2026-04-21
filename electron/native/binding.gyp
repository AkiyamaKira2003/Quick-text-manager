{
  "targets": [
    {
      "target_name": "quicktext_native",
      "msvs_windows_target_platform_version": "10.0",
      "sources": [
        "src/quicktext_native.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "_WIN32_WINNT=0x0A00"
      ],
      "cflags_cc": [
        "/std:c++20"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [
            "/std:c++20"
          ]
        }
      },
      "conditions": [
        [
          "OS==\"win\"",
          {
            "libraries": [
              "user32.lib"
            ]
          }
        ]
      ]
    }
  ]
}
