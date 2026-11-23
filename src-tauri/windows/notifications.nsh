; Protocol activation is handled by the OS. A stub activator on the Start Menu
; shortcut gives Windows Notification Center an identity for persisted toasts.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro MUI_STARTMENU_GETFOLDER Application $R6
  StrCpy $R7 "$SMPROGRAMS\$R6\${PRODUCTNAME}.lnk"
  !if "${STARTMENUFOLDER}" == ""
    StrCpy $R7 "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
  ${If} ${FileExists} "$R7"
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("$R7", ${STGM_READWRITE})'
        ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
        ${If} $2 P<> 0
          System::Alloc 16
          Pop $3
          System::Call 'ole32::CLSIDFromString(w "{0E4BAD97-88D9-4437-9782-40C35A9D109C}", p r3) i.r6'
          ${If} $6 == 0
            ; PKEY_AppUserModel_ToastActivatorCLSID, with a VT_CLSID property value.
            System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ToastActivatorCLSID})p.r4'
            System::Call '*${SYSSTRUCT_PROPVARIANT}(72,,&i${NSIS_PTR_SIZE} $3)p.r5'
            ${IPropertyStore::SetValue} $2 '($4,$5)'
            System::Free $4
            System::Free $5
            ${IPropertyStore::Commit} $2 ""
            ${IPersistFile::Save} $1 '("$R7",1)'
          ${EndIf}
          System::Free $3
          ${IUnknown::Release} $2 ""
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
  ${EndIf}
!macroend
