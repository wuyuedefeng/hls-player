### hls-player.js

```
npm i hls-player.js -S
```

vue/react ...
```
import 'hls-player.js'
```

for vite/vue use demo: https://github.com/rust-learning-examples/dev-toolbox/blob/main/src/views/hlsPlayer/index.vue


---
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + Svelte + TS</title>
  </head>
  <body>
    <hls-player></hls-player>
    <!--<script type="module" src="/src/main.ts"></script>-->
    <script src="./dist/hls-player.js"></script>
    <script>
      const el = document.querySelector('hls-player')
      el.addEventListener('beforeMount', event => {
        el.options = {debug: false, autoplay: true, muted: true}
        const videoEl = event.detail.video
        console.log('mount', event.detail, videoEl)
        // https://hls-js.netlify.app/demo/
        el.src = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
      }, {once: true})
      el.addEventListener('mounted', event => {
        const videoEl = event.detail.video
        console.log('mounted', event.detail, videoEl)
      }, {once: true})
    </script>
  </body>
</html>

```