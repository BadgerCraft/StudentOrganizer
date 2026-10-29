{
  "targets": [
    {
      "target_name": "windowsCredentialLedger",
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": [
              "windowsCredentialLedger.cc"
            ],
            "libraries": [
              "Advapi32.lib"
            ],
            "defines": [
              "NAPI_VERSION=3",
              "UNICODE",
              "_UNICODE"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          },
          {
            "type": "none"
          }
        ]
      ]
    }
  ]
}
