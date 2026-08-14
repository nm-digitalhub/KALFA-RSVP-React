"use strict";

self.addEventListener("push", function (event) {
  if (!event.data) {
    return;
  }

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text() };
  }

  const title = typeof data.title === "string" && data.title ? data.title : "KALFA";
  const targetUrl = typeof data.url === "string" && data.url ? data.url : "/app";

  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: typeof data.icon === "string" ? data.icon : "/icons/icon.svg",
    badge: typeof data.badge === "string" ? data.badge : "/icons/badge.svg",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: data.renotify === true,
    silent: data.silent === true,
    dir: "rtl",
    lang: "he",
    data: {
      url: targetUrl,
    },
  };

  // A notification MUST be shown for every push: iOS revokes the subscription
  // outright when a service worker handles a push and displays nothing, and
  // other browsers substitute their own "site updated in the background" notice.
  // So this replaces rather than removes — see notifyAgentsInboundCallResolved.
  //
  // Closing the same-tag notifications first is not redundant with `tag`.
  // Observed live on iOS 14.8: a same-tag push arrived ALONGSIDE the notification
  // it was meant to replace, leaving "שיחה נכנסת ממתינה במוקד" sitting under
  // "השיחה הנכנסת הסתיימה". Implicit tag replacement is not something to rely on
  // across platforms; closing explicitly is.
  event.waitUntil(
    Promise.resolve()
      .then(function () {
        // Guard hard: getNotifications({tag: undefined}) matches EVERY
        // notification this app has shown, so an untagged push would wipe the
        // lot. Only a real tag may close anything.
        if (typeof options.tag !== "string" || options.tag === "") {
          return undefined;
        }
        return self.registration
          .getNotifications({ tag: options.tag })
          .then(function (existing) {
            for (const n of existing) {
              n.close();
            }
          })
          .catch(function () {
            // Best-effort: never let a failed cleanup stop the notification
            // itself, which is the part iOS revokes the subscription over.
            return undefined;
          });
      })
      .then(function () {
        return self.registration.showNotification(title, options);
      }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const fallbackUrl = "/app";
  const rawUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : fallbackUrl;

  const targetUrl = new URL(rawUrl, self.location.origin).toString();

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then(function (clientList) {
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});
