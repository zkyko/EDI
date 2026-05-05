@echo off
echo Copying analyzer output to frontend/public/data/ ...
if not exist "frontend\public\data" mkdir "frontend\public\data"
copy /Y "output\procedures.json"       "frontend\public\data\procedures.json"
copy /Y "output\parser_validation.csv" "frontend\public\data\parser_validation.csv"
echo.
echo Done. Files are now ready for local dev AND will be picked up by GitHub Actions.
echo.
echo Next steps:
echo   cd frontend ^&^& npm install ^&^& npm run dev    (local preview)
echo   git add -A ^&^& git commit -m "update data" ^&^& git push    (deploy to GitHub Pages)
pause
