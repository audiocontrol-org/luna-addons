import type { MapPage, SurfaceLayout, SurfaceProfile } from '@audiocontrol/canonical-midi-maps';

export interface SurfaceDefinition {
  profile: SurfaceProfile;
  layout: SurfaceLayout;
}

export interface BundledMap {
  source: string;
  name: string;
  surface: string;
  pages: MapPage[];
}

export interface Bundle {
  contract: 2;
  audiocontrolRevision: string;
  surfaces: Record<string, SurfaceDefinition>; // key: surface id
  maps: Record<string, BundledMap>; // key: LUNA plugin id
}
