; CI-only deterministic post-copy failure fixture. Never a production include.
; Real deletion is bounded and observed; a locked executable fails this fixture
; instead of publishing a success marker or asking the harness to remove it.
!macro customInstall
  System::Call 'kernel32::GetCurrentProcessId() i.r8'
  StrCpy $7 0
  FileOpen $9 "$INSTDIR\student-organizer-ci-install-diagnostic.txt" w
  FileWrite $9 "format=student-organizer-install-failure-v1$\r$\nphase=deleting$\r$\npid=$8$\r$\n"
  FileClose $9
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" so_recovery_delete_retry so_recovery_precondition_failed
so_recovery_delete_retry:
  IntOp $7 $7 + 1
  ClearErrors
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  IfErrors so_recovery_delete_failed
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" so_recovery_delete_failed so_recovery_deleted
so_recovery_delete_failed:
  IntCmp $7 40 so_recovery_delete_exhausted so_recovery_delete_sleep so_recovery_delete_exhausted
so_recovery_delete_sleep:
  Sleep 250
  Goto so_recovery_delete_retry
so_recovery_deleted:
  ; Publish only after Delete succeeded AND the installed binary is absent.
  ClearErrors
  FileOpen $9 "$INSTDIR\student-organizer-ci-install-failure.tmp" w
  IfErrors so_recovery_marker_failed
  FileWrite $9 "format=student-organizer-install-failure-v1$\r$\nphase=deleted$\r$\npid=$8$\r$\nattempts=$7$\r$\n"
  FileClose $9
  IfErrors so_recovery_marker_failed
  Rename "$INSTDIR\student-organizer-ci-install-failure.tmp" "$INSTDIR\student-organizer-ci-install-failure.txt"
  IfErrors so_recovery_marker_failed
  SetErrorLevel 86
  Abort "Deliberate StudentOrganizer recovery acceptance fixture"
so_recovery_precondition_failed:
  StrCpy $6 "missing-before-delete"
  Goto so_recovery_diagnostic_failure
so_recovery_delete_exhausted:
  StrCpy $6 "delete-blocked"
  Goto so_recovery_diagnostic_failure
so_recovery_marker_failed:
  StrCpy $6 "marker-write-failed"
so_recovery_diagnostic_failure:
  FileOpen $9 "$INSTDIR\student-organizer-ci-install-diagnostic.txt" a
  FileWrite $9 "phase=$6$\r$\nattempts=$7$\r$\n"
  FileClose $9
  SetErrorLevel 87
  Abort "Recovery fixture could not verify its deliberate failure; inspect fixture diagnostics"
!macroend
