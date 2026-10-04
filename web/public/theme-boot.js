(function () {
  var pref = "system";
  try {
    var saved = window.localStorage.getItem("ll.theme");
    if (saved === "light" || saved === "dark" || saved === "system") pref = saved;
  } catch (e) {
    /* storage unavailable: current-session system default still applies */
  }
  var dark = pref === "dark" || (pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePref = pref;
  try {
    var motion = window.localStorage.getItem("ll.motion");
    if (motion === "reduced") root.dataset.motion = "reduced";
    var scale = window.localStorage.getItem("ll.textScale");
    if (scale) root.style.fontSize = scale + "%";
  } catch (e) {}
})();
