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
    dir: "rtl",
    lang: "he",
    data: {
      url: targetUrl,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
