@echo off
rem Runs this backend for trying the senior app on a phone, using the local
rem database\preview.sqlite file instead of MySQL (.env is not changed).
rem Sign-in codes are random. Without an SMS provider (SMS_DRIVER=log) they
rem are written to storage\logs\laravel.log instead of being texted; set
rem SMS_DRIVER=semaphore and SEMAPHORE_API_KEY in .env to text them.
rem The phone must be on the same Wi-Fi; allow port 8000 in Windows Firewall.
cd /d "%~dp0"
set DB_CONNECTION=sqlite
set DB_DATABASE=%~dp0database\preview.sqlite
if not exist "%DB_DATABASE%" type nul > "%DB_DATABASE%"
php artisan migrate --force
php artisan serve --host=0.0.0.0 --port=8000
