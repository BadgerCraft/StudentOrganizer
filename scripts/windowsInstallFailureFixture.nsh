; CI-only deterministic post-launch failure fixture.
; This file is supplied explicitly to one recovery build. It is not referenced
; by package.json and must never be used for a release installer.
!macro customInstall
  FileOpen $9 "$INSTDIR\student-organizer-ci-install-failure.txt" w
  FileWrite $9 "Deliberate StudentOrganizer recovery acceptance fixture.$\r$\n"
  FileClose $9
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  SetErrorLevel 86
  Abort "Deliberate StudentOrganizer recovery acceptance fixture"
!macroend
