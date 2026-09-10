import { redirect } from "next/navigation";
import { PublicPage } from "../components/public-page";
export default async function Home({searchParams}:{searchParams:Promise<{project?:string}>}) {const params=await searchParams;if(params.project&&/^[a-f0-9-]{36}$/.test(params.project))redirect(`/app/projects/${params.project}`);return <PublicPage/>;}
