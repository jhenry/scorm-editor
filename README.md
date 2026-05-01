# SCORM Text Editor (Local-first)

## What this is

A local-first, browser-based editor for SCORM packages that store content in `data.js` as:

```js
const surveyData = [ ... ];
```

## First run (local vendors)

This project expects vendor libraries to exist locally:

- `vendor/jszip.min.js`
- `vendor/json5.min.js`
- `tinymce/tinymce.min.js` plus supporting folders

Download them with:

```bash
bash scripts/bootstrap.sh
```

If you open the editor without vendors, it will show a banner with an optional "Load from CDN" button.

## Run

```bash
python3 -m http.server 8080
```

Open:

- http://localhost:8080

## New features in this build

- Plain text inputs for choices (no WYSIWYG on answers)
- Add/remove choices for MC questions
- Renumber choices button
- Validation (blocks apply/save on errors)
- Preview background is white to match typical LMS output
