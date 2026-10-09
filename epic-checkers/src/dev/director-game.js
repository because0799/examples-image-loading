// Full game build for Director integration checks: the real app (src/main.js) bundled into
// dist/dev/director-game/ (so dist/www, which the APK uses, is never touched by Director tests).
// Same URL parameters as the app, e.g. ?debug=1&screen=game&variant=russian&mode=demo&epic=1&fast=1
import '../main.js';
