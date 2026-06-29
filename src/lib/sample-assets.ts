import type { ExpressionLabel } from "@/lib/emotions";

export type SampleComicAsset = {
  id: string;
  title: string;
  imageSrc: string;
};

export type SampleFaceAsset = {
  id: string;
  name: string;
  role: string;
  expectedExpression: ExpressionLabel;
  imageSrc: string;
  sourceUrl: string;
  license: string;
};

export const SAMPLE_COMIC: SampleComicAsset = {
  id: "classroom-webtoon",
  title: "교실 감정 웹툰",
  imageSrc: "/sample-comics/classroom-webtoon.png",
};

export const SAMPLE_FACE_ASSETS = [
  {
    id: "neutral-suga-bts",
    name: "Suga",
    role: "BTS",
    expectedExpression: "Neutral",
    imageSrc: "/sample-faces/neutral-suga-bts.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Suga_at_a_fanmeeting,_22_September_2013.jpg",
    license: "CC BY 4.0",
  },
  {
    id: "happy-kim-jisoo-blackpink",
    name: "Kim Jisoo",
    role: "BLACKPINK",
    expectedExpression: "Happiness",
    imageSrc: "/sample-faces/happy-kim-jisoo-blackpink.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Kim_Jisoo_in_July_2023_05_(cropped).jpg",
    license: "CC BY 4.0",
  },
  {
    id: "sad-jennie-blackpink",
    name: "Jennie Kim",
    role: "BLACKPINK",
    expectedExpression: "Sadness",
    imageSrc: "/sample-faces/sad-jennie-blackpink.png",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File%3A171028_%ED%8F%89%EC%B0%BD_%EB%AE%A4%EC%A7%81%ED%8E%98%EC%8A%A4%ED%83%80_-_%EC%A0%9C%EB%8B%88%28%EB%B8%94%EB%9E%99%ED%95%91%ED%81%AC%29_%27STAY%27_4K_60P_%EC%A7%81%EC%BA%A0_by_DaftTaengk_%281%29.png",
    license: "CC BY 3.0",
  },
  {
    id: "anger-byun-baekhyun-exo",
    name: "Byun Baekhyun",
    role: "EXO",
    expectedExpression: "Anger",
    imageSrc: "/sample-faces/anger-byun-baekhyun-exo.png",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Byun_Baek-hyun_at_Korea_Music_Festival_on_October,_1_2017_(1).png",
    license: "CC BY 3.0",
  },
  {
    id: "surprise-jang-wonyoung-ive",
    name: "Jang Wonyoung",
    role: "IVE",
    expectedExpression: "Surprise",
    imageSrc: "/sample-faces/surprise-jang-wonyoung-ive.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Jang_Wonyoung_at_Produce48_9.png",
    license: "CC BY-SA 3.0",
  },
] as const satisfies readonly SampleFaceAsset[];
