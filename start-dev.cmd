@echo off
setlocal

set ROOT=%~dp0

echo HELIX XI local stack starting...
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:3000
echo Admin:    http://localhost:3002
echo.

start "HELIX XI Backend" cmd /k "cd /d "%ROOT%" && node server.js"
start "HELIX XI Frontend" cmd /k "cd /d "%ROOT%aria-frontend" && npm start"
start "HELIX XI Admin" cmd /k "cd /d "%ROOT%aria-admin" && npm start"

endlocal
