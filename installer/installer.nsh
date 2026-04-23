!macro customHeader
  !define MUI_ABORTWARNING
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_RIGHT
  !define MUI_WELCOMEPAGE_TITLE "Quick Text Setup"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will install Quick Text on your computer."
  !define MUI_FINISHPAGE_TITLE "Quick Text is ready"
  !define MUI_FINISHPAGE_TEXT "Setup is complete. You can launch Quick Text right away."
!macroend

!macro preInit
  SetRegView 64
!macroend

!macro customInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Quick Text"
!macroend
