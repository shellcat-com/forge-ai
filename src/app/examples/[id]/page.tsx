import { PublicPage } from "../../../components/public-page";
export default async function Page({params}:{params:Promise<{id:string}>}) {return <PublicPage kind="examples" id={(await params).id}/>;}
