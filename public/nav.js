// Shared page navigation: fills every <nav class="site-nav"> on the page.
(function () {
  var here = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  var links = [
    ["/", "RSVP"],
    ["/potluck", "Sign Up"],
    ["/whos-coming", "Who\u2019s Coming"],
    ["https://open.spotify.com/playlist/4Jliu98VSWwL240daEYfdh?si=YrcpM2NNQI-tC5Nm0pTx6A&utm_source=copy-link&pi=lNPE8MlIQRyb_&pt=00809f64f69d12973f7eb3c48cab9ec9", "Playlist", true]
  ];
  var html = links.map(function (l) {
    var cur = !l[2] && (l[0] === "/" ? here === "/" || here === "/index" : here === l[0]);
    return '<a href="' + l[0] + '"' + (cur ? ' aria-current="page"' : "") + (l[2] ? ' target="_blank" rel="noopener"' : "") + ">" + l[1] + "</a>";
  }).join("");
  document.querySelectorAll("nav.site-nav").forEach(function (n) { n.innerHTML = html; });
})();
