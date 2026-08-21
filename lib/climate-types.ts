export type ClimateActionName =
  | "set_temperature"
  | "set_hvac_mode"
  | "set_fan_mode"
  | "set_preset_mode"
  | "set_schedule_mode"
  | "clear_hold";

export type ClimateCapabilities = {
  setTemperature: boolean;
  setTemperatureRange: boolean;
  setHvacMode: boolean;
  setFanMode: boolean;
  setPresetMode: boolean;
  setScheduleMode: boolean;
  clearHold: boolean;
};

export type ClimateSnapshot = {
  available: boolean;
  name: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  targetTemperatureLow: number | null;
  targetTemperatureHigh: number | null;
  humidity: number | null;
  hvacMode: string;
  hvacModes: string[];
  hvacAction: string | null;
  fanMode: string | null;
  fanModes: string[];
  presetMode: string | null;
  presetModes: string[];
  scheduleMode: string | null;
  scheduleModes: string[];
  temperatureUnit: string;
  temperatureStep: number;
  minTemperature: number;
  maxTemperature: number;
  capabilities: ClimateCapabilities;
  updatedAt: string | null;
};

export type ClimateCommand =
  | {
    action: "set_temperature";
    temperature: number;
  }
  | {
    action: "set_temperature";
    targetLow: number;
    targetHigh: number;
  }
  | {
    action: "set_hvac_mode";
    hvacMode: string;
  }
  | {
    action: "set_fan_mode";
    fanMode: string;
  }
  | {
    action: "set_preset_mode";
    presetMode: string;
  }
  | {
    action: "set_schedule_mode";
    scheduleMode: string;
  }
  | {
    action: "clear_hold";
  };

export type ClimateCommandResult = ClimateSnapshot & {
  command: {
    action: ClimateActionName;
    status: "confirmed" | "accepted";
  };
};
