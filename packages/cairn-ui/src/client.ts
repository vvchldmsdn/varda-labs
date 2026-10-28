"use client";

import {useCallback,useEffect,useRef,type FormEvent} from "react";

/** React 19 resets uncontrolled forms after a resolved action even when its
 * application result represents an error. Keep drafts unless success explicitly
 * authorizes a reset; never change the action or submitted FormData contract. */
export function useActionFormReset(state: {status:string}, {resetOnSuccess=false}: {resetOnSuccess?:boolean} = {}) {
 const formElement=useRef<HTMLFormElement>(null);
 const allowReset=useRef(false);
 // Keep the mutable DOM ref private. Consumers only receive commit/event
 // callbacks, so reading the returned handlers never reads a ref in render.
 const formRef=useCallback((element:HTMLFormElement|null)=>{
  formElement.current=element;
 },[]);
 const onReset=useCallback((event:FormEvent<HTMLFormElement>)=>{
  if(!allowReset.current)event.preventDefault();
 },[]);
 useEffect(()=>{
  if(!resetOnSuccess||state.status!=="success"||!formElement.current)return;
  allowReset.current=true;
  try {formElement.current.reset();} finally {allowReset.current=false;}
 },[state,resetOnSuccess]);
 return {formRef,onReset};
}
