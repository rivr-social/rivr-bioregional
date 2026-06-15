export const FRONT_RANGE_CULTURAL_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Boulder Commons",
        layer: "cultural",
        kind: "locale-anchor",
      },
      geometry: {
        type: "Point",
        coordinates: [-105.2705, 40.015],
      },
    },
    {
      type: "Feature",
      properties: {
        name: "Front Range",
        layer: "cultural",
        kind: "region-anchor",
      },
      geometry: {
        type: "Point",
        coordinates: [-104.99, 39.7392],
      },
    },
    {
      type: "Feature",
      properties: {
        name: "South Platte Commons",
        layer: "cultural",
        kind: "watershed-anchor",
      },
      geometry: {
        type: "Point",
        coordinates: [-105.0, 40.1],
      },
    },
  ],
} as const
