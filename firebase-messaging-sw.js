// Firebase Messaging Service Worker — handles background push notifications
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDKQ_xUD8taMNk1kYuKX580Yc1ccMEA7_4",
  authDomain: "zagu-ordering-portal.firebaseapp.com",
  projectId: "zagu-ordering-portal",
  storageBucket: "zagu-ordering-portal.firebasestorage.app",
  messagingSenderId: "699948373847",
  appId: "1:699948373847:web:7271be6c7f6e3a4b551012",
});

const messaging = firebase.messaging();

// Handle background messages (when app is not in foreground)
messaging.onBackgroundMessage((payload) => {
  console.log("[Zagu FCM] Background message:", payload);

  const { title, body, icon } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title || "Zagu Orders", {
    body: body || "You have a new notification",
    icon: icon || "/zagu-ordering-portal/icon-192x192.png",
    badge: "/zagu-ordering-portal/icon-72x72.png",
    tag: data.orderId || "zagu-notification",
    data: { url: "https://tomarai-369.github.io/zagu-ordering-portal/", ...data },
    vibrate: [200, 100, 200],
    requireInteraction: true,
  });
});

// Handle notification click — open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "https://tomarai-369.github.io/zagu-ordering-portal/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("zagu-ordering-portal") && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
