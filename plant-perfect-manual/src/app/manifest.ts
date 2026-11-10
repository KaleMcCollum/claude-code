import type { MetadataRoute } from "next";

/** Lets phones add the app to the home screen, opening straight to Today. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plant Perfect Fargo Manual",
    short_name: "Plant Perfect",
    description: "Operations manual and decision log for Plant Perfect Fargo.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
