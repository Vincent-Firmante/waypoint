const elements = {
  locateButton: document.querySelector("#locate-button"),
  buttonLabel: document.querySelector("#button-label"),
  notice: document.querySelector("#notice"),
  noticeText: document.querySelector("#notice-text"),
  locationState: document.querySelector("#location-state"),
  placeTitle: document.querySelector("#place-title"),
  latitude: document.querySelector("#latitude"),
  longitude: document.querySelector("#longitude"),
  address: document.querySelector("#address"),
  accuracy: document.querySelector("#accuracy"),
  distanceFromHere: document.querySelector("#distance-from-here"),
  mapLink: document.querySelector("#map-link"),
  map: document.querySelector("#map"),
  mapFrame: document.querySelector("#map-frame"),
  mapExpandButton: document.querySelector("#map-expand-button"),
  mapEmpty: document.querySelector("#map-empty"),
  themeToggle: document.querySelector("#theme-toggle"),
  placeSearchForm: document.querySelector("#place-search-form"),
  placeQuery: document.querySelector("#place-query"),
  placeSearchButton: document.querySelector("#place-search-button"),
  placeSearchResults: document.querySelector("#place-search-results"),
  routeButton: document.querySelector("#route-button"),
  routeButtonLabel: document.querySelector("#route-button-label"),
  routeStatus: document.querySelector("#route-status"),
  routeProfiles: document.querySelector("#route-profiles"),
  shareButton: document.querySelector("#share-location-button"),
  recentSearches: document.querySelector("#recent-searches"),
  installButton: document.querySelector("#install-button"),
  temperatureUnits: document.querySelector("#temperature-units"),
  distanceUnits: document.querySelector("#distance-units"),
  temperatureUnit: document.querySelector("#temperature-unit"),
  temperature: document.querySelector("#temperature"),
  weatherDescription: document.querySelector("#weather-description"),
  weatherSymbol: document.querySelector("#weather-symbol"),
  humidity: document.querySelector("#humidity"),
  wind: document.querySelector("#wind"),
  feelsLike: document.querySelector("#feels-like"),
  weatherUpdated: document.querySelector("#weather-updated"),
};

let liveMap;
let positionMarker;
let accuracyCircle;
let selectedDestination;
let currentPosition;
let currentPositionMarker;
let routeLayer;
let mapTapMarker;
let trackingWatchId = null;
let routeRequestInProgress = false;
let lastRouteOrigin;
let lastRouteUpdate = 0;
let lastReverseLookupAt = 0;
let deferredInstallPrompt;
let lastWeatherCoordinates;
let lastRouteMetrics;
let weatherRequestId = 0;
let recentSearches = loadRecentSearches();
let routeProfile = readPreference("fieldnote-route-profile", ["driving", "walking", "cycling"], "driving");
let temperatureUnit = readPreference("fieldnote-temperature-unit", ["celsius", "fahrenheit"], "celsius");
let distanceUnit = readPreference("fieldnote-distance-unit", ["km", "mi"], "km");

function readPreference(key, allowedValues, fallback) {
  try {
    const savedValue = localStorage.getItem(key);
    return allowedValues.includes(savedValue) ? savedValue : fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

function applyTheme(theme, persist = true) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selectedTheme;
  const nextTheme = selectedTheme === "dark" ? "light" : "dark";
  elements.themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
  elements.themeToggle.title = `Switch to ${nextTheme} mode`;
  document.querySelector('meta[name="theme-color"]').content = selectedTheme === "dark" ? "#081321" : "#edf3f8";
  if (persist) {
    try {
      localStorage.setItem("fieldnote-theme", selectedTheme);
    } catch {
    }
  }
}

const savedTheme = readPreference("fieldnote-theme", ["dark", "light"], "dark");
applyTheme(savedTheme, false);
elements.themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  if (routeLayer) {
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--route-color").trim();
    routeLayer.setStyle({ color: routeColor });
  }
  if (liveMap) requestAnimationFrame(() => liveMap.invalidateSize());
});

const weatherCodes = new Map([
  [0, ["Clear sky", "☼"]], [1, ["Mainly clear", "◉"]], [2, ["Partly cloudy", "◐"]], [3, ["Overcast", "☁"]],
  [45, ["Fog", "≋"]], [48, ["Depositing rime fog", "≋"]],
  [51, ["Light drizzle", "☂"]], [53, ["Drizzle", "☂"]], [55, ["Dense drizzle", "☂"]], [56, ["Freezing drizzle", "❄"]], [57, ["Freezing drizzle", "❄"]],
  [61, ["Light rain", "☂"]], [63, ["Rain", "☂"]], [65, ["Heavy rain", "☂"]], [66, ["Freezing rain", "❄"]], [67, ["Heavy freezing rain", "❄"]],
  [71, ["Light snow", "❄"]], [73, ["Snow", "❄"]], [75, ["Heavy snow", "❄"]], [77, ["Snow grains", "❄"]],
  [80, ["Light rain showers", "☂"]], [81, ["Rain showers", "☂"]], [82, ["Violent rain showers", "☂"]], [85, ["Snow showers", "❄"]], [86, ["Heavy snow showers", "❄"]],
  [95, ["Thunderstorm", "ϟ"]], [96, ["Thunderstorm with hail", "ϟ"]], [99, ["Thunderstorm with hail", "ϟ"]],
]);

function setNotice(message, kind = "info") {
  elements.notice.dataset.kind = kind;
  elements.noticeText.textContent = message;
}

function loadRecentSearches() {
  try {
    const savedSearches = JSON.parse(localStorage.getItem("fieldnote-recent-searches") || "[]");
    return Array.isArray(savedSearches)
      ? savedSearches.filter((query) => typeof query === "string" && query.trim()).slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function renderRecentSearches() {
  elements.recentSearches.replaceChildren();
  elements.recentSearches.hidden = recentSearches.length === 0;
  if (!recentSearches.length) return;

  const label = document.createElement("span");
  label.className = "recent-label";
  label.textContent = "RECENT";
  elements.recentSearches.append(label);

  recentSearches.forEach((query) => {
    const button = document.createElement("button");
    button.className = "recent-search-button";
    button.type = "button";
    button.textContent = query;
    button.addEventListener("click", () => {
      elements.placeQuery.value = query;
      elements.placeSearchForm.requestSubmit();
    });
    elements.recentSearches.append(button);
  });
}

function rememberRecentSearch(query) {
  recentSearches = [query, ...recentSearches.filter((savedQuery) => savedQuery.toLowerCase() !== query.toLowerCase())].slice(0, 5);
  writePreference("fieldnote-recent-searches", JSON.stringify(recentSearches));
  renderRecentSearches();
}

function setBusy(isBusy) {
  elements.locateButton.disabled = isBusy;
  elements.buttonLabel.textContent = isBusy ? "Finding you…" : "Find my location";
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser does not support location services."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

async function fetchJson(url, serviceName) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${serviceName} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function updateLiveMap(latitude, longitude, accuracy) {
  if (!window.L) {
    elements.mapEmpty.lastElementChild.textContent = "The street map could not load. Use Open map to view your location.";
    return;
  }

  const point = [latitude, longitude];
  elements.mapEmpty.hidden = true;

  if (!liveMap) {
    liveMap = window.L.map(elements.map, { scrollWheelZoom: true }).setView(point, 16);
    liveMap.on("click", showAddressAtMapPoint);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(liveMap);
    positionMarker = window.L.circleMarker(point, {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#244d3b",
      fillOpacity: 1,
    }).addTo(liveMap);
    accuracyCircle = window.L.circle(point, {
      radius: Math.max(accuracy, 20),
      color: "#244d3b",
      weight: 1,
      fillColor: "#87a88e",
      fillOpacity: 0.2,
    }).addTo(liveMap);
  } else {
    liveMap.flyTo(point, 16);
    positionMarker.setLatLng(point);
    accuracyCircle.setLatLng(point).setRadius(Math.max(accuracy, 20));
  }

  requestAnimationFrame(() => liveMap.invalidateSize());
}

function showMapPopup(point, message) {
  if (!liveMap) return;
  if (!mapTapMarker) {
    mapTapMarker = window.L.circleMarker(point, {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: getComputedStyle(document.documentElement).getPropertyValue("--deep-green").trim(),
      fillOpacity: 1,
    }).addTo(liveMap);
  } else {
    mapTapMarker.setLatLng(point);
  }
  const popupContent = document.createElement("div");
  popupContent.className = "map-popup-address";
  popupContent.textContent = message;
  mapTapMarker.bindPopup(popupContent).openPopup();
}

async function reverseGeocode(latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
    addressdetails: "1",
  });
  lastReverseLookupAt = Date.now();
  const result = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, "OpenStreetMap geocoder");
  if (!result || typeof result.display_name !== "string" || !result.display_name) {
    throw new Error("No nearby address was found for these coordinates.");
  }
  return result;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable in this browser.");
}

async function copyShareableLink() {
  const coordinates = selectedDestination || currentPosition;
  if (!coordinates) return;

  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("lat", String(coordinates.latitude));
  shareUrl.searchParams.set("lon", String(coordinates.longitude));
  try {
    await copyText(shareUrl.toString());
    setNotice("A shareable location link was copied.", "success");
  } catch (error) {
    setNotice(`Could not copy the location link: ${error.message}`, "error");
  }
}

async function showSharedLocation(latitude, longitude) {
  if (trackingWatchId !== null) stopRouteTracking();
  if (routeLayer) {
    routeLayer.remove();
    routeLayer = null;
  }
  lastRouteMetrics = undefined;
  selectedDestination = { latitude, longitude };
  elements.latitude.textContent = latitude.toFixed(6);
  elements.longitude.textContent = longitude.toFixed(6);
  elements.placeTitle.textContent = "Shared location";
  elements.address.textContent = "Looking up address…";
  elements.accuracy.textContent = "Accuracy: shared coordinates";
  elements.locationState.dataset.state = "located";
  elements.locationState.innerHTML = '<span class="state-dot"></span> SHARED LINK';
  elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
  elements.routeButton.disabled = false;
  elements.shareButton.disabled = false;
  elements.routeStatus.hidden = true;
  setRouteTracking(false);
  updateDistanceFromHere();
  updateLiveMap(latitude, longitude, 20);
  setNotice("Opening the shared location…", "success");

  const [addressResult, weatherResult] = await Promise.allSettled([
    loadAddress(latitude, longitude),
    loadWeather(latitude, longitude),
  ]);
  const failures = [];
  if (addressResult.status === "rejected") {
    elements.address.textContent = `Address lookup unavailable: ${addressResult.reason.message}`;
    failures.push("address");
  }
  if (weatherResult.status === "rejected") {
    elements.weatherDescription.textContent = "Weather unavailable";
    elements.weatherUpdated.textContent = weatherResult.reason.message;
    failures.push("weather");
  }
  if (failures.length) {
    setNotice(`Shared coordinates loaded, but ${failures.join(" and ")} data could not be loaded.`, "error");
  } else {
    setNotice("Shared location, address, and weather are ready.", "success");
  }
}

async function loadSharedLocationFromUrl() {
  const parameters = new URLSearchParams(window.location.search);
  if (!parameters.has("lat") && !parameters.has("lon")) return;

  const latitude = Number(parameters.get("lat"));
  const longitude = Number(parameters.get("lon"));
  if (!parameters.has("lat") || !parameters.has("lon")
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    setNotice("This shared link has invalid coordinates.", "error");
    return;
  }
  await showSharedLocation(latitude, longitude);
}

async function showAddressAtMapPoint(event) {
  const { lat, lng } = event.latlng;
  const point = [lat, lng];
  if (Date.now() - lastReverseLookupAt < 1100) {
    showMapPopup(point, "Please wait a moment before looking up another map point.");
    return;
  }

  showMapPopup(point, "Looking up address…");
  try {
    const result = await reverseGeocode(lat, lng);
    showMapPopup(point, result.display_name);
  } catch (error) {
    showMapPopup(point, `Address unavailable: ${error.message}`);
  }
}

function syncMapSizeControl() {
  const expanded = document.fullscreenElement === elements.mapFrame || elements.mapFrame.classList.contains("map-expanded");
  elements.mapExpandButton.setAttribute("aria-pressed", String(expanded));
  elements.mapExpandButton.setAttribute("aria-label", expanded ? "Minimize map" : "Expand map");
  elements.mapExpandButton.title = expanded ? "Minimize map" : "Expand map";
  document.body.classList.toggle("map-locked", expanded && elements.mapFrame.classList.contains("map-expanded"));
  if (liveMap) requestAnimationFrame(() => liveMap.invalidateSize());
}

function setRouteTracking(isTracking) {
  elements.routeButtonLabel.textContent = isTracking ? "Stop tracking" : "Route here";
  elements.routeButton.setAttribute("aria-pressed", String(isTracking));
  elements.routeButton.disabled = !selectedDestination;
}

function showRouteStatus(message) {
  elements.routeStatus.textContent = message;
  elements.routeStatus.hidden = !message;
}

function formatDistance(meters) {
  const convertedDistance = distanceUnit === "mi" ? meters / 1609.344 : meters / 1000;
  const unit = distanceUnit;
  return convertedDistance < 0.1 ? `< 0.1 ${unit}` : `${convertedDistance.toFixed(1)} ${unit}`;
}

function renderRouteStatus() {
  if (!lastRouteMetrics) return;
  const profileName = { driving: "DRIVE", cycling: "CYCLE", walking: "WALK" }[routeProfile];
  showRouteStatus(`${profileName} ROUTE · ${formatDistance(lastRouteMetrics.distance)} · ${Math.max(1, Math.round(lastRouteMetrics.duration / 60))} min`);
}

async function loadDrivingRoute(origin, destination) {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const result = await fetchJson(
    `https://router.project-osrm.org/route/v1/${routeProfile}/${coordinates}?overview=full&geometries=geojson&steps=false`,
    "Route planner",
  );
  const route = result.routes?.[0];
  if (!route?.geometry?.coordinates?.length) {
    throw new Error("No driving route is available between these places.");
  }

  if (routeLayer) routeLayer.remove();
  const routeColor = getComputedStyle(document.documentElement).getPropertyValue("--route-color").trim() || "#f5c05e";
  routeLayer = window.L.geoJSON(route.geometry, {
    style: { color: routeColor, weight: 5, opacity: 0.92 },
  }).addTo(liveMap);
  liveMap.fitBounds(routeLayer.getBounds().pad(0.12));
  lastRouteOrigin = origin;
  lastRouteUpdate = Date.now();
  lastRouteMetrics = { distance: route.distance, duration: route.duration };
  renderRouteStatus();
}

function distanceBetween(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function updateDistanceFromHere() {
  if (!selectedDestination) {
    elements.distanceFromHere.textContent = "Search for a place to calculate distance.";
    return;
  }
  if (!currentPosition) {
    elements.distanceFromHere.textContent = "Find your location to calculate distance.";
    return;
  }

  const distanceMeters = distanceBetween(currentPosition, selectedDestination);
  const convertedDistance = distanceUnit === "mi" ? distanceMeters / 1609.344 : distanceMeters / 1000;
  elements.distanceFromHere.textContent = convertedDistance < 0.1
    ? `Less than 0.1 ${distanceUnit} away`
    : `${convertedDistance.toFixed(1)} ${distanceUnit} away`;
}

function renderUnitControls() {
  elements.temperatureUnits.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.unit === temperatureUnit));
  });
  elements.distanceUnits.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.unit === distanceUnit));
  });
  elements.temperatureUnit.textContent = temperatureUnit === "fahrenheit" ? "°F" : "°C";
}

function renderRouteProfiles() {
  elements.routeProfiles.querySelectorAll("button[data-profile]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.profile === routeProfile));
  });
}

async function refreshWeatherForUnits() {
  if (!lastWeatherCoordinates) return;
  try {
    await loadWeather(lastWeatherCoordinates.latitude, lastWeatherCoordinates.longitude);
  } catch (error) {
    elements.weatherDescription.textContent = "Weather unavailable";
    elements.weatherUpdated.textContent = error.message;
  }
}

async function selectRouteProfile(event) {
  const button = event.target.closest("button[data-profile]");
  if (!button || !["driving", "walking", "cycling"].includes(button.dataset.profile)) return;
  routeProfile = button.dataset.profile;
  writePreference("fieldnote-route-profile", routeProfile);
  renderRouteProfiles();

  if (routeLayer && currentPosition && selectedDestination) {
    showRouteStatus("UPDATING ROUTE…");
    try {
      await loadDrivingRoute(currentPosition, selectedDestination);
      const trackingMessage = trackingWatchId === null ? "" : " Live tracking continues.";
      setNotice(`${routeProfile} route updated.${trackingMessage}`, "success");
    } catch (error) {
      showRouteStatus(`${routeProfile.toUpperCase()} ROUTE UNAVAILABLE`);
      setNotice(`Could not load that route profile: ${error.message}`, "error");
    }
  }
}

async function selectTemperatureUnit(event) {
  const button = event.target.closest("button[data-unit]");
  if (!button || !["celsius", "fahrenheit"].includes(button.dataset.unit)) return;
  temperatureUnit = button.dataset.unit;
  writePreference("fieldnote-temperature-unit", temperatureUnit);
  renderUnitControls();
  await refreshWeatherForUnits();
}

async function selectDistanceUnit(event) {
  const button = event.target.closest("button[data-unit]");
  if (!button || !["km", "mi"].includes(button.dataset.unit)) return;
  distanceUnit = button.dataset.unit;
  writePreference("fieldnote-distance-unit", distanceUnit);
  renderUnitControls();
  updateDistanceFromHere();
  renderRouteStatus();
  await refreshWeatherForUnits();
}

async function refreshRouteFromPosition(origin) {
  if (routeRequestInProgress || !lastRouteOrigin || Date.now() - lastRouteUpdate < 15000) return;
  if (distanceBetween(lastRouteOrigin, origin) < 35) return;

  routeRequestInProgress = true;
  try {
    await loadDrivingRoute(origin, selectedDestination);
  } catch {
    showRouteStatus("TRACKING · ROUTE UPDATE UNAVAILABLE");
  } finally {
    routeRequestInProgress = false;
  }
}

function handleTrackedPosition(position) {
  currentPosition = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  updateDistanceFromHere();
  const point = [currentPosition.latitude, currentPosition.longitude];
  if (!currentPositionMarker) {
    currentPositionMarker = window.L.circleMarker(point, {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: "#ff936f",
      fillOpacity: 1,
    }).addTo(liveMap).bindPopup("You are here");
  } else {
    currentPositionMarker.setLatLng(point);
  }
  refreshRouteFromPosition(currentPosition);
}

function stopRouteTracking() {
  if (trackingWatchId !== null) navigator.geolocation.clearWatch(trackingWatchId);
  trackingWatchId = null;
  setRouteTracking(false);
  if (selectedDestination && routeLayer) showRouteStatus("ROUTE READY · TRACKING PAUSED");
}

async function startRouteTracking() {
  if (!selectedDestination) return;
  elements.routeButton.disabled = true;
  setNotice("Getting your position and planning a driving route…");

  try {
    const position = await getPosition();
    currentPosition = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    lastRouteOrigin = currentPosition;
    handleTrackedPosition(position);
    await loadDrivingRoute(currentPosition, selectedDestination);
    trackingWatchId = navigator.geolocation.watchPosition(
      handleTrackedPosition,
      (error) => {
        stopRouteTracking();
        setNotice(`Route is ready, but live tracking stopped: ${describeLocationError(error)}`, "error");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    setRouteTracking(true);
    setNotice("Driving route ready. Your position is being tracked while this page is open.", "success");
  } catch (error) {
    setRouteTracking(false);
    elements.routeButton.disabled = !selectedDestination;
    setNotice(`Could not start route tracking: ${error.message}`, "error");
  }
}

async function toggleRouteTracking() {
  if (trackingWatchId !== null) {
    stopRouteTracking();
    setNotice("Route tracking stopped. The route remains on the map.", "success");
    return;
  }
  await startRouteTracking();
}

async function toggleMapSize() {
  if (document.fullscreenElement === elements.mapFrame) {
    await document.exitFullscreen();
  } else if (elements.mapFrame.classList.contains("map-expanded")) {
    elements.mapFrame.classList.remove("map-expanded");
    syncMapSizeControl();
  } else if (elements.mapFrame.requestFullscreen) {
    try {
      await elements.mapFrame.requestFullscreen();
    } catch {
      elements.mapFrame.classList.add("map-expanded");
      syncMapSizeControl();
    }
  } else {
    elements.mapFrame.classList.add("map-expanded");
    syncMapSizeControl();
  }
}

async function loadAddress(latitude, longitude) {
  const result = await reverseGeocode(latitude, longitude);
  const parts = result.address || {};
  const locality = parts.city || parts.town || parts.village || parts.hamlet || parts.county;
  elements.placeTitle.textContent = locality || parts.state || parts.country || "Nearby place";
  elements.address.textContent = result.display_name;
  if (positionMarker) positionMarker.bindPopup(result.display_name);
}

async function searchPlaces(query) {
  const params = new URLSearchParams({ q: query, limit: "5" });
  const result = await fetchJson(`https://photon.komoot.io/api/?${params}`, "Photon place search");
  return Array.isArray(result.features) ? result.features : [];
}

async function showSearchedPlace(place) {
  const [longitude, latitude] = place.geometry?.coordinates || [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    setNotice("That search result did not include valid coordinates. Try another place.", "error");
    return;
  }

  const parts = place.properties || {};
  const locality = parts.city || parts.name || parts.state || parts.country;
  const displayName = [...new Set([parts.name, parts.district, parts.city, parts.state, parts.country].filter(Boolean))].join(", ");
  elements.latitude.textContent = latitude.toFixed(6);
  elements.longitude.textContent = longitude.toFixed(6);
  elements.placeTitle.textContent = locality || parts.state || parts.country || "Searched place";
  elements.address.textContent = displayName || "Address details unavailable for this place.";
  elements.accuracy.textContent = "Accuracy: searched place";
  elements.locationState.dataset.state = "located";
  elements.locationState.innerHTML = '<span class="state-dot"></span> SEARCH RESULT';
  elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
  updateLiveMap(latitude, longitude, 20);
  if (trackingWatchId !== null) stopRouteTracking();
  if (routeLayer) {
    routeLayer.remove();
    routeLayer = null;
  }
  lastRouteMetrics = undefined;
  selectedDestination = { latitude, longitude };
  updateDistanceFromHere();
  setRouteTracking(false);
  elements.routeButton.disabled = false;
  elements.shareButton.disabled = false;
  elements.routeStatus.hidden = true;
  if (positionMarker) positionMarker.bindPopup(displayName);
  setNotice(`Loading current weather for ${elements.placeTitle.textContent}…`, "success");

  try {
    await loadWeather(latitude, longitude);
    setNotice(`Showing the location and current weather for ${elements.placeTitle.textContent}.`, "success");
  } catch (error) {
    elements.weatherDescription.textContent = "Weather unavailable";
    elements.weatherUpdated.textContent = error.message;
    setNotice(`The place was found, but its weather could not be loaded: ${error.message}`, "error");
  }
}

async function handlePlaceSearch(event) {
  event.preventDefault();
  const query = elements.placeQuery.value.trim();
  if (!query) return;

  elements.placeSearchButton.disabled = true;
  elements.placeSearchResults.hidden = false;
  elements.placeSearchResults.replaceChildren();
  setNotice(`Searching for “${query}”…`);

  try {
    const places = await searchPlaces(query);
    if (!Array.isArray(places) || places.length === 0) {
      setNotice(`No places found for “${query}”. Try a nearby city or a more specific address.`, "error");
      elements.placeSearchResults.hidden = true;
      return;
    }
    rememberRecentSearch(query);

    places.forEach((place) => {
      const resultButton = document.createElement("button");
      resultButton.className = "search-result";
      resultButton.type = "button";
      const properties = place.properties || {};
      resultButton.textContent = [...new Set([properties.name, properties.district, properties.city, properties.state, properties.country].filter(Boolean))].join(", ") || "Unnamed place";
      resultButton.addEventListener("click", () => {
        elements.placeSearchResults.hidden = true;
        showSearchedPlace(place);
      });
      elements.placeSearchResults.append(resultButton);
    });

    if (places.length === 1) {
      elements.placeSearchResults.hidden = true;
      await showSearchedPlace(places[0]);
    } else {
      setNotice(`Found ${places.length} places. Choose the one you mean.`, "success");
    }
  } catch (error) {
    elements.placeSearchResults.hidden = true;
    setNotice(`Place search failed: ${error.message}`, "error");
  } finally {
    elements.placeSearchButton.disabled = false;
  }
}

async function loadWeather(latitude, longitude) {
  const requestId = ++weatherRequestId;
  lastWeatherCoordinates = { latitude, longitude };
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    timezone: "auto",
    temperature_unit: temperatureUnit,
    wind_speed_unit: distanceUnit === "mi" ? "mph" : "kmh",
  });
  const result = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, "Open-Meteo");
  const current = result.current;
  if (!current || !Number.isFinite(current.temperature_2m)) {
    throw new Error("Weather data was missing from the response.");
  }
  if (requestId !== weatherRequestId) return;

  const [description, symbol] = weatherCodes.get(current.weather_code) || ["Conditions unavailable", "·"];
  elements.temperature.firstChild.textContent = String(Math.round(current.temperature_2m));
  elements.temperatureUnit.textContent = temperatureUnit === "fahrenheit" ? "°F" : "°C";
  elements.weatherDescription.textContent = description;
  elements.weatherSymbol.textContent = current.is_day ? symbol : (current.weather_code === 0 ? "☾" : symbol);
  elements.humidity.textContent = `${current.relative_humidity_2m}%`;
  elements.wind.textContent = `${Math.round(current.wind_speed_10m)} ${distanceUnit === "mi" ? "mph" : "km/h"}`;
  elements.feelsLike.textContent = `${Math.round(current.apparent_temperature)}°${temperatureUnit === "fahrenheit" ? "F" : "C"}`;

  const observedAt = current.time ? new Date(current.time) : new Date();
  elements.weatherUpdated.textContent = `Observed ${observedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} local time · Open-Meteo`;
}

function describeLocationError(error) {
  if (error.code === 1) return "Location permission was denied. Allow access in your browser settings, then try again.";
  if (error.code === 2) return "Your location could not be determined. Check that location services are enabled and try again.";
  if (error.code === 3) return "Finding your location took too long. Move to an area with a clearer signal and try again.";
  return error.message || "Could not access your location. Try again.";
}

async function locate() {
  setBusy(true);
  setNotice("Waiting for your browser to find your location…");
  elements.locationState.dataset.state = "pending";
  elements.locationState.innerHTML = '<span class="state-dot"></span> LOCATING';

  try {
    const position = await getPosition();
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    if (trackingWatchId !== null) stopRouteTracking();
    selectedDestination = undefined;
    setRouteTracking(false);
    elements.routeButton.disabled = true;
    elements.routeStatus.hidden = true;
    if (routeLayer) {
      routeLayer.remove();
      routeLayer = null;
    }
    lastRouteMetrics = undefined;
    currentPosition = { latitude, longitude };
    updateDistanceFromHere();
    elements.shareButton.disabled = false;

    elements.latitude.textContent = latitude.toFixed(6);
    elements.longitude.textContent = longitude.toFixed(6);
    elements.accuracy.textContent = `Accuracy: about ${Math.round(position.coords.accuracy)} m`;
    elements.locationState.dataset.state = "located";
    elements.locationState.innerHTML = '<span class="state-dot"></span> LOCATED';
    elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    updateLiveMap(latitude, longitude, position.coords.accuracy);
    setNotice("Coordinates found. Looking up the nearest address and current weather.", "success");

    const tasks = [
      loadAddress(latitude, longitude).catch((error) => {
        elements.placeTitle.textContent = "Coordinates found";
        elements.address.textContent = `Address lookup unavailable: ${error.message}`;
      }),
      loadWeather(latitude, longitude).catch((error) => {
        elements.weatherDescription.textContent = "Weather unavailable";
        elements.weatherUpdated.textContent = error.message;
      }),
    ];
    await Promise.all(tasks);

    const addressReady = elements.address.textContent !== "Your readable address will appear here." && !elements.address.textContent.startsWith("Address lookup unavailable:");
    const weatherReady = elements.weatherDescription.textContent !== "Weather unavailable";
    if (!addressReady || !weatherReady) {
      const unavailable = [!addressReady && "address", !weatherReady && "weather"].filter(Boolean).join(" and ");
      setNotice(`Your coordinates are ready, but ${unavailable} data could not be loaded. You can still open the map or try again.`, "error");
    } else {
      setNotice("Location, address, and local weather are up to date.", "success");
    }
  } catch (error) {
    setNotice(describeLocationError(error), "error");
    elements.locationState.dataset.state = "error";
    elements.locationState.innerHTML = '<span class="state-dot"></span> NOT LOCATED';
  } finally {
    setBusy(false);
  }
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) return;
  try {
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = undefined;
    elements.installButton.hidden = true;
    if (choice.outcome === "accepted") setNotice("Waypoint was added to your home screen.", "success");
  } catch (error) {
    setNotice(`Could not start installation: ${error.message}`, "error");
  }
}

function registerProgressiveWebApp() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

renderRecentSearches();
renderUnitControls();
renderRouteProfiles();
elements.locateButton.addEventListener("click", locate);
elements.placeSearchForm.addEventListener("submit", handlePlaceSearch);
elements.mapExpandButton.addEventListener("click", toggleMapSize);
elements.routeButton.addEventListener("click", toggleRouteTracking);
elements.routeProfiles.addEventListener("click", selectRouteProfile);
elements.shareButton.addEventListener("click", copyShareableLink);
elements.temperatureUnits.addEventListener("click", selectTemperatureUnit);
elements.distanceUnits.addEventListener("click", selectDistanceUnit);
elements.installButton.addEventListener("click", handleInstallClick);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = undefined;
  elements.installButton.hidden = true;
});
document.addEventListener("fullscreenchange", syncMapSizeControl);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.mapFrame.classList.contains("map-expanded")) {
    elements.mapFrame.classList.remove("map-expanded");
    syncMapSizeControl();
  }
});
loadSharedLocationFromUrl();
registerProgressiveWebApp();