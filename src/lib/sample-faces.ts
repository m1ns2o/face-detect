import type { ExpressionLabel } from "@/lib/emotions";

export type SampleFace = {
  id: string;
  name: string;
  expectedExpression: ExpressionLabel;
  imageSrc: string;
  sourceUrl: string;
  license: string;
};

export const sampleFaces = [
  {
    id: "chaplin-publicity",
    name: "Charlie Chaplin",
    expectedExpression: "Neutral",
    imageSrc: "https://upload.wikimedia.org/wikipedia/commons/c/c4/Chaplin-publicity-signed.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Chaplin-publicity-signed.jpg",
    license: "Public domain",
  },
  {
    id: "marilyn-1952",
    name: "Marilyn Monroe",
    expectedExpression: "Happiness",
    imageSrc: "https://upload.wikimedia.org/wikipedia/commons/1/15/Marilyn_Monroe_1952.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Marilyn_Monroe_1952.jpg",
    license: "Public domain",
  },
  {
    id: "buster-keaton",
    name: "Buster Keaton",
    expectedExpression: "Neutral",
    imageSrc:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Buster_Keaton_in_Photoplay%2C_December_1924.jpg/960px-Buster_Keaton_in_Photoplay%2C_December_1924.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Buster_Keaton_in_Photoplay,_December_1924.jpg",
    license: "Public domain",
  },
  {
    id: "audrey-my-fair-lady",
    name: "Audrey Hepburn",
    expectedExpression: "Surprise",
    imageSrc:
      "https://upload.wikimedia.org/wikipedia/commons/1/12/Harry_Stradling-Audrey_Hepburn_in_My_Fair_Lady_%28cropped%29.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Harry_Stradling-Audrey_Hepburn_in_My_Fair_Lady_(cropped).jpg",
    license: "Public domain",
  },
] as const satisfies readonly SampleFace[];
