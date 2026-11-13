export function thumbnailUrl(url, width = 640, height = 720) {
  if (!url || !url.startsWith("https://res.cloudinary.com/")) return url;
  return url.replace(
    "/image/upload/",
    `/image/upload/c_fill,w_${width},h_${height},q_auto,f_auto/`,
  );
}
