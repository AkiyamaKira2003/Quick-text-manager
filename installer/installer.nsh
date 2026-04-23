!macro customHeader
  !define MUI_ABORTWARNING
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Quick Text"
  !define MUI_WELCOMEPAGE_TEXT "A focused setup for your snippet workflow. Install in less than a minute and launch instantly."
  !define MUI_FINISHPAGE_TITLE "Quick Text is installed"
  !define MUI_FINISHPAGE_TEXT "Setup is complete. Start Quick Text now to manage and trigger snippets right away."
!macroend

!macro preInit
  SetRegView 64
!macroend

!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Quick Text"
!macroend
