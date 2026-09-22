export type IntroVideo = {
  name: string;
  role: string;
  src: string;
  poster: string;
  width: number;
  height: number;
};

export const introVideos: IntroVideo[] = [
  {
    name: 'René Duijkers',
    role: 'Partner & accountant',
    src: '/videos/avydo-rene-duijkers.mp4',
    poster: '/images/video-poster-rene-duijkers.jpg',
    width: 512,
    height: 288,
  },
  {
    name: 'Eric Verbaandert',
    role: 'Partner & fiscaal adviseur',
    src: '/videos/avydo-eric-verbaandert.mp4',
    poster: '/images/video-poster-eric-verbaandert.jpg',
    width: 512,
    height: 288,
  },
];
