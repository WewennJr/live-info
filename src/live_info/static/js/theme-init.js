/* Applique le thème avant l'affichage pour éviter un flash.
   Fichier séparé : la politique de sécurité (CSP) interdit les scripts écrits directement dans la page. */
try {
    var t = localStorage.getItem('live-info:theme');
    if (t !== 'light' && t !== 'dark') t = null;
    document.documentElement.dataset.theme = t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
} catch (e) { document.documentElement.dataset.theme = 'dark'; }