import MapDisplay from "@/components/map-display";
import { ImageProvider } from "@/contexts/ImageContext";
import { LocationsProvider } from "@/contexts/InputCaption";

export default function Page() {
  return (
    <ImageProvider>
      <LocationsProvider>
        <div style={{ height: "100vh", width: "100vw" }}>
          <MapDisplay />
        </div>
      </LocationsProvider>
    </ImageProvider>
  );
}
