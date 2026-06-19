import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

const RestApiReference = () => {
  return (
    <div style={{ background: '#0f0f13', minHeight: '100vh', overflow: 'hidden' }}>
      <ApiReferenceReact
        configuration={{
          spec: { url: "/api/v1/docs/json" },
          theme: "kepler",
          layout: "modern",
        }}
      />
    </div>
  );
};

export default RestApiReference;
