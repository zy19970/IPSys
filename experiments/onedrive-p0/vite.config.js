import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
 plugins:[react()],
 // All JS/CSS/assets locally bundled. This P0 trial must not use CDN.
 base:"./",build:{outDir:"dist",emptyOutDir:true}
});
