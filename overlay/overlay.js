const root = document.createElement('div');
root.id = 'fractured-realms-companion-scaffold';
root.textContent = 'Fractured Realms Companion is under construction.';
root.style.cssText = [
  'position:fixed',
  'right:1rem',
  'bottom:1rem',
  'z-index:2147483000',
  'padding:.75rem 1rem',
  'border:1px solid #555',
  'border-radius:.5rem',
  'background:#171717',
  'color:#eee',
  'font:14px system-ui,sans-serif',
].join(';');

document.body?.append(root);
