; Inno Setup script for the Invexa Retail Windows app. Built by
; .github/workflows/windows.yml from the Flutter release output:
;   iscc /DAppVersion=1.3.0 /DSourceDir=<build\windows\x64\runner\Release> InvexaRetail.iss
; Installs per-user (no admin prompt) with a Start Menu entry and an optional
; desktop shortcut; uninstalls cleanly from Settings > Apps.

#ifndef AppVersion
  #define AppVersion "1.3.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\build\windows\x64\runner\Release"
#endif

[Setup]
AppId={{6F1C2B9E-4D3A-4E8B-9A57-2C1D0E8F7A31}
AppName=Invexa Retail
AppVersion={#AppVersion}
AppPublisher=Invexa Retail
AppPublisherURL=https://invexaretail.com/
DefaultDirName={autopf}\Invexa Retail
DefaultGroupName=Invexa Retail
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=InvexaRetail-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\InvexaRetail.exe
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Invexa Retail"; Filename: "{app}\InvexaRetail.exe"
Name: "{autodesktop}\Invexa Retail"; Filename: "{app}\InvexaRetail.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\InvexaRetail.exe"; Description: "{cm:LaunchProgram,Invexa Retail}"; Flags: nowait postinstall skipifsilent
