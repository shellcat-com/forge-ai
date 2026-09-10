import { Workspace } from "../../../../components/workspace";
export default async function Page({params}:{params:Promise<{id:string}>}){return <Workspace id={(await params).id}/>;}
