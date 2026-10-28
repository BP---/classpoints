@echo off

rem Always run inside a clean cmd.exe, even when started from PowerShell or
rem another shell. /d skips any cmd AutoRun scripts; the marker argument stops
rem the script from relaunching itself again.
if /i not "%~1"=="--in-cmd" (
    "%SystemRoot%\System32\cmd.exe" /d /c ""%~f0" --in-cmd"
    exit /b
)

setlocal

rem ---------------------------------------------------------------------------
rem  Starts the ClassPoints server and opens it in the browser.
rem
rem  PROJECT_DIR is the folder that contains server.py. "%~dp0" means "the
rem  folder this .bat file is in", which works when you start this file from the
rem  project folder or through a desktop shortcut to it. If you copy this file
rem  somewhere else instead, replace it with the full path, for example:
rem      set "PROJECT_DIR=C:\Users\me\classpoints"
rem ---------------------------------------------------------------------------
set "PROJECT_DIR=%~dp0"
set "PORT=8007"

title ClassPoints server (port %PORT%)
cd /d "%PROJECT_DIR%" || (
    echo Could not find the project folder: %PROJECT_DIR%
    pause
    exit /b 1
)

rem Prefer the Python launcher (py), fall back to python on PATH.
set "PYTHON="
set "WHERE=%SystemRoot%\System32\where.exe"
"%WHERE%" py >nul 2>nul && set "PYTHON=py -3"
if not defined PYTHON "%WHERE%" python >nul 2>nul && set "PYTHON=python"
if not defined PYTHON (
    echo Python was not found. Install it from https://www.python.org/downloads/
    echo and tick "Add python.exe to PATH" during installation.
    pause
    exit /b 1
)

%PYTHON% server.py --port %PORT% --open
if errorlevel 1 pause
