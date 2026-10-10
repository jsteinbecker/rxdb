# Local pill photos (development only)

Drop a photo of a pill here, named by its NDC, and in development the app uses
it for that package's mockup: the click-to-photo toggle shows it and the
imprint-layout analyzer measures it. It takes precedence over the label's
photo and NLM's archive.

- `00378027101.jpg` or `00378-0271-01.jpg` — any hyphenation of the NDC
- `00093214062_2.png` — part 2 of a kit (the second pill the package describes)
- `.jpg`, `.jpeg`, `.png` or `.webp`

Everything here except this file is gitignored, and the route that serves these
files (`/dev/pill-photos/…`) answers 404 outside `vite dev`. Only save photos
you're entitled to use; this folder is for your own local work.

Replacing a file is picked up on the next page load, and its layout is
re-measured.
