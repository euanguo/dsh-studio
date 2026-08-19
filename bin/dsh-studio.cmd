@ECHO off
SETLOCAL
SET "ROOT=%~dp0.."

IF EXIST "%ROOT%\node-runtime\node.exe" IF EXIST "%ROOT%\lib\dsh-studio\cli.js" (
  SET "DSH_STUDIO_WEB_ROOT=%ROOT%"
  SET "DSH_STUDIO_TUI_ROOT=%ROOT%"
  "%ROOT%\node-runtime\node.exe" "%ROOT%\lib\dsh-studio\cli.js" %*
  EXIT /B %ERRORLEVEL%
)

IF NOT EXIST "%ROOT%\dist\dsh-studio.js" (
  ECHO DSH Studio is not built. Run pnpm run build first. 1>&2
  EXIT /B 1
)

SET "DSH_STUDIO_SOURCE_ROOT=%ROOT%"
node "%ROOT%\dist\dsh-studio.js" %*
