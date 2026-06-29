import { ExpressionStudio } from "@/components/expression-studio";
import { SAMPLE_COMIC, SAMPLE_FACE_ASSETS } from "@/lib/sample-assets";

export default function TestPage() {
  return (
    <ExpressionStudio
      testAssets={{
        sampleComic: SAMPLE_COMIC,
        sampleFaces: SAMPLE_FACE_ASSETS,
      }}
    />
  );
}
