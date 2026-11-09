# KSL (three.js project)

Quick way: open ksl.html (single file, double-click it).

To work on the code:

    npm install
    npm run dev      # dev server (open the printed localhost link, do not double-click index.html)
    npm run build    # writes dist/index.html, one self-contained file
    npm run dev      # dev server with hot reload
    npm run build    # production build in dist/

- index.html: page markup (panel, buttons, sliders)
- src/main.js: scene, rendering, interaction, rip / spray / burn / crumple / fold / shred, hand control
- src/sheet.js: paper solver (position based dynamics: links, bending, creases, layer collisions)
- src/pose.js: crease / fold pose maths for the zigzag, accordion, fan crumple
- src/fragmentation.js: the paper model (Andrejevic et al. 2021): facet area distribution, crease length vs compaction and number of crumples
- src/shaders.js: GLSL for the poster and flame
- src/style.css: UI styles
- public/: put favicon.png here

three.js is pinned to 0.128.0, the version the project was written against.
