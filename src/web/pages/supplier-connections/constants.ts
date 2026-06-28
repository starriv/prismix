export const BEDROCK_REGIONS = [
  { code: "us-east-1", label: "US East (N. Virginia)" },
  { code: "us-east-2", label: "US East (Ohio)" },
  { code: "us-west-2", label: "US West (Oregon)" },
  { code: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { code: "ap-south-2", label: "Asia Pacific (Hyderabad)" },
  { code: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { code: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { code: "ap-northeast-3", label: "Asia Pacific (Osaka)" },
  { code: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { code: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { code: "ca-central-1", label: "Canada (Central)" },
  { code: "eu-central-1", label: "Europe (Frankfurt)" },
  { code: "eu-central-2", label: "Europe (Zurich)" },
  { code: "eu-west-1", label: "Europe (Ireland)" },
  { code: "eu-west-2", label: "Europe (London)" },
  { code: "eu-west-3", label: "Europe (Paris)" },
  { code: "eu-south-1", label: "Europe (Milan)" },
  { code: "eu-south-2", label: "Europe (Spain)" },
  { code: "eu-north-1", label: "Europe (Stockholm)" },
  { code: "sa-east-1", label: "South America (Sao Paulo)" },
  { code: "us-gov-east-1", label: "AWS GovCloud (US-East)" },
  { code: "us-gov-west-1", label: "AWS GovCloud (US-West)" },
] as const;

export const DEFAULT_UPSTREAM_PRIORITY = 1000;
export const DEFAULT_UPSTREAM_WEIGHT = 1;
