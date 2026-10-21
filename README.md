# <img src="assets/icon-48.png" width="36" height="36" align="center" alt="old-tube icon" /> old-tube

Sick of the obnoxious, and shit content the YouTube algorithm is force feeding down you? Or the waves of clickbait, and annoying thumbnails? Well hopefully this extension will help you out a bit. With this you can select to have all search results from YouTube be from a certain particular year, such as 2014, or 2007. And you can also have multiple selected at a time if you prefer to instead like both 2014 and 2007.  It also replaces suggested videos in the sidebar to the year you wish to watch them from as well. Project is currently experimental, and we shall see how it goes.

## How It Operates Under the Hood
1. **Search Query Interception:** When you run a search or apply a year filter, the content script intercepts the request and appends YouTube's `after:YYYY-12-31` and `before:YYYY-01-01` date boundaries spanning your selected years, then strips those raw operators from the search input box, URL bar, and tab title so the UI stays clean.
2. **Strict DOM Filtering:** Because YouTube still injects Shorts shelves and out-of-range recommendations into search results, the script parses each video renderer's upload timestamp ("X years ago") against your selected target years and hides non-matching items and shelves in real time.
3. **Sidebar Feed Fetching:** Since YouTube's native watch-page sidebar API does not support date filtering, the extension extracts keywords from the current video's title, fetches a background search scoped to your chosen year(s), parses the returned `ytInitialData` JSON, and renders matching video cards directly in the sidebar.

## Screenshots
![Popup UI](assets/popup-preview.png)

![In-Page Filter Bar](assets/search-bar-preview.png)

![Sidebar Feed Filter](assets/sidebar-preview.png)
