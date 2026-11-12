@echo off
chcp 65001 >nul
echo.
echo ══════════════════════════════════════════════
echo    TeMa Media Service — Configuration Windows
echo ══════════════════════════════════════════════
echo.

:: ── Vérifier les droits Administrateur ───────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Ce script doit etre execute en tant qu'Administrateur.
    echo.
    echo   Clic droit sur setup-windows.bat
    echo   puis "Executer en tant qu'administrateur"
    echo.
    pause
    exit /b 1
)

:: ── Trouver node.exe ──────────────────────────────────────────────────────
for /f "tokens=* usebackq" %%i in (`where node 2^>nul`) do (
    set "NODE_EXE=%%i"
    goto :node_found
)
echo [ERREUR] Node.js introuvable. Installez Node.js puis relancez ce script.
pause
exit /b 1
:node_found
echo [1/4] Node.js detecte : %NODE_EXE%

:: ── Créer le répertoire de logs ───────────────────────────────────────────
if not exist "C:\TeMa\logs" mkdir "C:\TeMa\logs"

:: ── Créer le script de démarrage ─────────────────────────────────────────
set "SERVICE_DIR=%~dp0"
set "START_BAT=C:\TeMa\start-media-service.bat"

(
    echo @echo off
    echo cd /d "%SERVICE_DIR%"
    echo "%NODE_EXE%" index.js ^>^> "C:\TeMa\logs\service.log" 2^>^&1
) > "%START_BAT%"

echo [2/4] Script de demarrage cree : %START_BAT%

:: ── Enregistrer dans le Planificateur de tâches ───────────────────────────
:: Supprime l'ancienne tâche si elle existe
schtasks /delete /tn "TeMa-Media-Service" /f >nul 2>&1

:: Crée la tâche : démarre 60s après l'ouverture de session (laisse Windows s'initialiser)
schtasks /create ^
    /tn "TeMa-Media-Service" ^
    /tr "\"%START_BAT%\"" ^
    /sc ONLOGON ^
    /delay 0001:00 ^
    /rl HIGHEST ^
    /f >nul

if errorlevel 1 (
    echo [ERREUR] Impossible de creer la tache planifiee.
) else (
    echo [3/4] Tache "TeMa-Media-Service" enregistree : demarre 1min apres connexion
)

:: ── Désactiver la veille et l'hibernation sur secteur ────────────────────
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0

echo [4/4] Veille / hibernation desactivees sur secteur ✓

:: ── Résumé ────────────────────────────────────────────────────────────────
echo.
echo ══════════════════════════════════════════════
echo   Configuration terminee avec succes !
echo.
echo   - Demarrage auto : au prochain login Windows
echo   - Logs : C:\TeMa\logs\service.log
echo   - Veille systeme : desactivee sur secteur
echo.
echo   Redemarrez le PC pour tester le demarrage auto.
echo ══════════════════════════════════════════════
echo.
pause
