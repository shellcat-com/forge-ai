import { readFile, writeFile } from 'node:fs/promises'
let html = await readFile('output/respawn/provider-original.html', 'utf8')
html = html.replaceAll('<svg width="18"', '<svg class="icon" aria-hidden="true" width="18"').replace('<svg class="icon" aria-hidden="true"><circle', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle')
html = html.replace("tag: 'Best seller'", "tag: 'Featured'").replace("tag: 'Limited'", "tag: 'Concept'")
html = html.replace('Sunrise colorway, responsive controls.', 'Second concept listing; shared product image.').replace('Dark lavender, compact precision.', 'Second concept listing; shared product image.').replace('Cool gray, immersive sound.', 'Second concept listing; shared product image.').replace('Bright coral, lightweight control.', 'Second concept listing; shared product image.')
html = html.replace('dialog.innerHTML += `<div class="cart-total">Subtotal: $${totalPrice}</div>`;', "const subtotal = document.createElement('div'); subtotal.className = 'cart-total'; subtotal.textContent = `Subtotal: $${totalPrice}`; dialog.appendChild(subtotal);")
html = html.replace("minus.textContent = '-';", "minus.textContent = '−'; minus.setAttribute('aria-label', `Decrease ${item.name}`);")
html = html.replace("plus.textContent = '+';", "plus.textContent = '+'; plus.setAttribute('aria-label', `Increase ${item.name}`);")
html = html.replace("removeBtn.textContent = 'Remove';", "removeBtn.textContent = 'Remove'; removeBtn.setAttribute('aria-label', `Remove ${item.name}`);")
html = html.replace("      // PRODUCT DATA", `      // Upgrade generated overlays to native modal dialogs for focus containment.
      document.querySelectorAll('.dialog-overlay').forEach(overlay => {
        const dialog = document.createElement('dialog');
        for (const attr of overlay.attributes) dialog.setAttribute(attr.name, attr.value);
        dialog.style.removeProperty('display');
        dialog.append(...overlay.childNodes);
        overlay.replaceWith(dialog);
      });
      // PRODUCT DATA`)
html = html.replace(/(cartOverlay|checkoutOverlay|loginOverlay|confirmationOverlay)\.style\.display = 'flex';/g, 'if (!$1.open) $1.showModal();').replace(/(cartOverlay|checkoutOverlay|loginOverlay|confirmationOverlay)\.style\.display = 'none';/g, '$1.close();')
html = html.replace(/ {6}let lastFocusedElement = null;\n/, '').replace(/ {8}lastFocusedElement = document.activeElement;\n/g,'').replace(/ {8}if \(lastFocusedElement\) lastFocusedElement.focus\(\);\n/g,'')
html = html.replace("        const name = document.getElementById('checkoutNameInput')", "        if (!cart.length) return;\n        const name = document.getElementById('checkoutNameInput')")
html = html.replace("        confirmationOverlay.close();\n      });", "        closeConfirmation();\n      });")
html = html.replace("        checkoutOverlay.close();\n        if (!confirmationOverlay.open)", "        checkoutOverlay.close();\n        cartOverlay.close();\n        if (!confirmationOverlay.open)")
html = html.replace("      function openLogin() {", "      function openLogin() {\n        if (loggedInUser) { loggedInUser = null; loginBtn.textContent = 'Demo login'; loginBtn.setAttribute('aria-label', 'Demo login'); return; }")
html = html.replace("loginBtn.textContent = `Hi, ${name}`;", "loginBtn.textContent = `Hi, ${name} · Sign out`;\n        loginBtn.setAttribute('aria-label', `Sign out ${name}`);")
html = html.replace("id=\"displayNameInput\"", "id=\"displayNameInput\" maxlength=\"32\"").replace("id=\"checkoutNameInput\"", "id=\"checkoutNameInput\" maxlength=\"32\"")
html = html.replace("      // escape key handling", `      // Native cancel restores focus to each dialog's invoking control.
      [[cartOverlay, closeCart], [loginOverlay, closeLogin], [checkoutOverlay, closeCheckout], [confirmationOverlay, closeConfirmation]].forEach(([dialog, close]) => dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }));
      // escape key handling`)
// Native dialogs handle Escape themselves, avoiding double-close of stacked dialogs.
html = html.replace(/ {6}\/\/ escape key handling[\s\S]*? {6}\}\);\n {4}\}\)\(\);/, '    })();')
html = html.replaceAll("{behavior:'smooth'}", "{behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}")
html = html.replace("        currentFilter = 'saved';\n        filterTabs", "        currentFilter = 'saved';\n        document.getElementById('gear').scrollIntoView({behavior:'instant'});\n        filterTabs")
html = html.replace('<div class="card-img" style="background-image:url(\'${product.img}\');" role="img" aria-label="${product.name}">', '<div class="card-img"><img src="${product.img}" alt="${product.name}" width="640" height="640" loading="lazy">')
html = html.replace('  </style>' , `    /* Reviewed refinements: icons, dialog focus, mobile fit, reduced motion. */
    .card-img > img { width:100%; height:100%; object-fit:cover; position:absolute; inset:0; border-radius:inherit; }
    .header-wrapper { padding: 14px 24px; }
    .dialog-overlay { margin:0; width:100%; max-width:none; height:100%; max-height:none; padding:0; border:0; color:var(--text); background:transparent; }
    .dialog-overlay:not([open]) { display:none; }
    .dialog-overlay[open] { display:flex; }
    .dialog-overlay::backdrop { background:rgba(0,0,0,.65); backdrop-filter:blur(5px); }
    .dialog-overlay:not(#cartOverlay) .cart-dialog { max-height:90dvh; border:1px solid var(--border); }
    .cart-item { flex-wrap:wrap; }
    .cart-item > span { flex-basis:100%; }
    .qty-btn { width:44px; height:44px; }
    .cart-item > button { min-height:44px; margin-left:auto; }
    #gear, #collections { scroll-margin-top:96px; }
    #loginBtn { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .search-box:focus-within { outline:3px solid var(--accent-dark); outline-offset:3px; }
    @media(max-width:768px) { .header-wrapper { padding:12px 18px; } #gear,#collections { scroll-margin-top:180px; } }
    @media(max-width:480px) { .logo-area{font-size:1.4rem;} .hero-title{font-size:2.65rem;} .hero-content{padding:32px 22px;} .hero::before{background:rgba(8,8,12,.5);} .icon-buttons{gap:8px; width:100%;} .icon-btn{padding:8px 12px;} #gear,#collections{scroll-margin-top:220px;} }
  </style>`)
await writeFile('output/respawn/reviewed-source.html', html)
for (const name of ['hero', 'controller', 'keyboard', 'headset', 'mouse']) {
 const data=(await readFile(`public/marketplace/${name}.webp`)).toString('base64')
 html=html.replaceAll(`http://127.0.0.1:5173/marketplace/${name}.webp`, `data:image/webp;base64,${data}`)
}
await writeFile('output/respawn/index.html',html)
console.log('Reviewed source and portable standalone site saved.')
