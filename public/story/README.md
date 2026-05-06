# Story photo

The Story section on the cinema landing (`/cinema`) renders the file at:

```
public/story/portrait.jpg
```

To swap the photo:

1. On GitHub, navigate to `public/story/`.
2. Click **Add file → Upload files**.
3. Drag in your image and **rename it `portrait.jpg`** (case-sensitive, exactly that name) so it overwrites the current one.
4. Commit. Netlify redeploys and the new photo appears.

## Notes

- Aspect ratio: **3:4 portrait** (e.g. 1200×1600). Anything close works — the frame crops to fill.
- Format: JPG or PNG, served at the path. If you upload a `.png`, also rename to `portrait.jpg` (yes, even though it's PNG bytes — the browser doesn't care). Or rename the file to `portrait.png` and update the `<img src>` in `src/components/cinema/CinemaLanding.tsx` (one line).
- Size: aim for under 500KB. Shopify-style image optimizers (squoosh.app, tinyjpg.com) get you there in a few seconds.
- If no `portrait.jpg` is present, the Story section falls back to the dark "Drop a photo" placeholder.
