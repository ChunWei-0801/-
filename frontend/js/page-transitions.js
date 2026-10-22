/* Route-only motion: no timers delay navigation or data requests. */
(function (global) {
  'use strict';
  var previousRoute = null, previousActor = null, nativeTransition = null, animation = null, expiry = null, revision = 0;
  function clearFlags() {
    delete document.documentElement.dataset.routeMoving;
    delete document.documentElement.dataset.routeDirection;
  }
  function cancel() {
    revision++;
    if (expiry !== null) global.clearTimeout(expiry);
    expiry = null;
    if (nativeTransition && nativeTransition.skipTransition) nativeTransition.skipTransition();
    nativeTransition = null;
    if (animation) animation.cancel();
    animation = null;
    clearFlags();
  }
  function reduced() { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function run(view, options, render) {
    options = options || {};
    var route = String(options.route || '#/'), actor = options.authenticated ? String(options.accountId || 'signed-in') : 'signed-out';
    var changed = previousRoute !== null && previousRoute !== route, changedActor = previousActor !== null && previousActor !== actor;
    previousRoute = route; previousActor = actor;
    cancel();
    var mine = revision, called = false, returned;
    function once() { if (!called) { called = true; returned = render(); } return returned; }
    // Never retain an outgoing private snapshot across an account boundary.
    if (!view || !view.isConnected || !changed || changedActor || reduced()) return once();
    var back = /^#\/?$/.test(route);
    document.documentElement.dataset.routeMoving = 'true';
    document.documentElement.dataset.routeDirection = back ? 'back' : 'forward';
    function finish() { if (revision === mine) { nativeTransition = null; animation = null; if (expiry !== null) global.clearTimeout(expiry); expiry = null; clearFlags(); } }
    expiry = global.setTimeout(function () { if (revision === mine) cancel(); }, 1200);
    if (typeof document.startViewTransition === 'function') {
      try {
        nativeTransition = document.startViewTransition(once);
        Promise.resolve(nativeTransition.finished).then(finish, finish);
        // A failed capture must still render once, never duplicate API actions.
        if (nativeTransition.updateCallbackDone) nativeTransition.updateCallbackDone.catch(function () { once(); finish(); });
        return nativeTransition;
      } catch (_) { once(); finish(); return returned; }
    }
    once();
    var content = view.firstElementChild;
    if (content && typeof content.animate === 'function') {
      animation = content.animate([{opacity:0.45,transform:'translateX('+(back?-20:24)+'px)'},{opacity:1,transform:'translateX(0)'}], {duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});
      Promise.resolve(animation.finished).then(finish,finish);
    } else finish();
    return returned;
  }
  global.addEventListener('hashchange',cancel);
  global.addEventListener('pagehide',cancel);
  document.addEventListener('visibilitychange',function () { if (document.hidden) cancel(); });
  global.PageTransitions = Object.freeze({run:run,cancel:cancel});
})(typeof window !== 'undefined' ? window : globalThis);
