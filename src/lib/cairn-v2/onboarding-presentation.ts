// Display only: uses the same provider capability as the canonical writer.
export function onboardingCollectionVisible(providerConfigured:boolean,runtime:{binding:string;execution:string;mutations:boolean}){
 return providerConfigured&&runtime.binding==='aligned'&&runtime.execution==='service'&&runtime.mutations;
}
